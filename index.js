const { promisify } = require("util")
const fs = require("fs")
const fsp = require("fs/promises")
const glob = require("glob")
const glog = require("fancy-log")
const sharp = require("sharp")
const { createHash } = require("crypto")
const mkdirp = require('mkdirp')
const Queue = require('promise-queue');
const AbortController = require("abort-controller").default

const { getInstancesInfos } = require('./getInstancesInfos')
const instanceq = require('./instanceq')

function getHash(data, a, b, c) {
	const hashv = createHash(a)
	hashv.update(Buffer.from(data), b)
	return hashv.digest(c)
}

async function downloadTemp(name, url, tempDir, alwaysReturn) {
	const files = glob.sync(`${tempDir}${name}.*`)

	function clean() {
		files.map(file => fs.unlink(file, () => null))
		return false
	}

	const request = await (async () => {
		mkdirp.sync(tempDir)
		const controller = new AbortController()
		const timeout = setTimeout(
			() => { controller.abort() },
			10000
		)
		return fetch(url, {
			encoding: null,
			signal: controller.signal,
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:99.0) Gecko/20100101 Firefox/99.0"
			}
		}).then(res => {
			clearTimeout(timeout)
			return res
		}, () => {
			clearTimeout(timeout)
			return false
		})
	})();

	if (typeof request !== 'object') {
		glog.error(url, 'request fail!')
		return clean()
	}
	if (!request.ok) {
		glog.error(url, 'request ng!')
		return clean()
	}
	const data = await Promise.race([
		request.arrayBuffer(),
		new Promise(resolve => setTimeout(() => resolve(false), 10000))
	])
	if (!data) {
		glog.error(url, 'arrayBuffer is null or timeout!')
		return clean()
	}

	function safeWriteFile(name, ab, status) {
		const controller = new AbortController()
		const timeout = setTimeout(
			() => { controller.abort() },
			30000
		)
		return fsp.writeFile(`${tempDir}${name}`, Buffer.from(ab), { signal: controller.signal })
			.then(() => {
				clearTimeout(timeout)
				return { name, status }
			})
			.catch(e => {
				glog.error('writeFile error', name, e)
				return false
			})
	}

	if (files.length > 0) {
		const local = await fsp.readFile(`${tempDir}${name}`).catch(() => false)
		if (!local) return false
		if (getHash(data, "sha384", "binary", "base64") !== getHash(local, "sha384", "binary", "base64")) {
			return safeWriteFile(name, data, "renewed")
		}
		if (alwaysReturn) return { name, status: "unchanged" }
		return false
	}
	
	return safeWriteFile(name, data, "created")
}

getInstancesInfos()
	.then(async ({alives, deads, notMisskey, outdated, versions, versionOutput}) => {
		fs.writeFile('./dist/versions.json', JSON.stringify(versionOutput), () => { })

		const stats = alives.reduce((prev, v) => v.nodeinfo.usage ? ({
			  notesCount: v.nodeinfo.usage.localPosts + prev.notesCount,
			  usersCount: v.nodeinfo.usage.users.total + prev.usersCount,
			  mau: v.nodeinfo.usage.users.activeMonth + prev.mau,
			  instancesCount: 1 + prev.instancesCount
		  }) : prev, { notesCount: 0, usersCount: 0, mau: 0, instancesCount: 0 })

		fs.writeFile('./dist/alives.txt', alives.map(v => v.url).join('\n'), () => { })
		fs.writeFile('./dist/deads.txt', deads.map(v => v.url).join('\n'), () => { })
		fs.writeFile('./dist/not-misskey.txt', notMisskey.map(v => v.url).join('\n'), () => { })
		fs.writeFile('./dist/outdated.txt', outdated.map(v => v.url).join('\n'), () => { })

		await mkdirp('./dist/instance-banners')
		await mkdirp('./dist/instance-backgrounds')
		await mkdirp('./dist/instance-icons')

		const infoQueue = new Queue(3)
		const instancesInfosPromises = [];

		for (const instance of alives) {
			if (instance.meta.bannerUrl) {
				instancesInfosPromises.push(infoQueue.add(async () => {
					glog(`downloading banner for ${instance.url}`)
					const res = await downloadTemp(`${instance.url}`, (new URL(instance.meta.bannerUrl, `https://${instance.url}`)).toString(), `./temp/instance-banners/`, true)
					if (res) instance.banner = true
					else instance.banner = false

					if (res && res.status !== "unchanged") {
						const base = sharp(`./temp/instance-banners/${res.name}`)
							.resize({
								width: 1024,
								withoutEnlargement: true,
							})
						if (!base) {
							instance.banner = false
							return;
						}
						try {
							await base.jpeg({ quality: 80, progressive: true })
								.toFile(`./dist/instance-banners/${instance.url}.jpeg`)
							await base.webp({ quality: 75 })
								.toFile(`./dist/instance-banners/${instance.url}.webp`)
						} catch (e) {
							glog.error(`error while processing banner for ${instance.url}`, e);
							instance.banner = false
						}
					}
				}))
			} else {
				instance.banner = false
			}

			if (instance.meta.backgroundImageUrl) {
				instancesInfosPromises.push(infoQueue.add(async () => {
					glog(`downloading background image for ${instance.url}`)
					const res = await downloadTemp(`${instance.url}`, (new URL(instance.meta.backgroundImageUrl, `https://${instance.url}`)).toString(), `./temp/instance-backgrounds/`, true)
					if (res) instance.background = true
					else instance.background = false
					if (res && res.status !== "unchanged") {
						const base = sharp(`./temp/instance-backgrounds/${res.name}`)
							.resize({
								width: 1024,
								withoutEnlargement: true,
							})

						if (!base) {
							instance.background = false
							return;
						}

						try {
							await base.jpeg({ quality: 80, progressive: true })
								.toFile(`./dist/instance-backgrounds/${instance.url}.jpeg`)
							await base.webp({ quality: 75 })
								.toFile(`./dist/instance-backgrounds/${instance.url}.webp`)
						} catch (e) {
							glog.error(`error while processing background for ${instance.url}`, e);
							instance.background = false
						}
					}
				}))
			} else {
				instance.background = false
			}

			if (instance.meta.iconUrl) {
				instancesInfosPromises.push(infoQueue.add(async () => {
					glog(`downloading icon image for ${instance.url}`)
					const res = await downloadTemp(`${instance.url}`, (new URL(instance.meta.iconUrl, `https://${instance.url}`)).toString(), `./temp/instance-icons/`, true)
					if (res) instance.icon = true
					else instance.icon = false
					if (res && res.status !== "unchanged") {
						const base = sharp(`./temp/instance-icons/${res.name}`)
							.resize({
								height: 200,
								withoutEnlargement: true,
							})

						if (!base) {
							instance.icon = false
							return;
						}

						try {
							await base.png()
								.toFile(`./dist/instance-icons/${instance.url}.png`)
							await base.webp({ quality: 75 })
								.toFile(`./dist/instance-icons/${instance.url}.webp`)
						} catch (e) {
							glog.error(`error while processing icon for ${instance.url}`, e);
							instance.icon = false
						}
					}
				}))
			} else {
				instance.icon = false
			}
		}

		await Promise.allSettled(instancesInfosPromises)

		const INSTANCES_JSON = {
			date: new Date(),
			stats,
			instancesInfos: alives
		}

		fs.writeFile('./dist/instances.json', JSON.stringify(INSTANCES_JSON), () => { })

		glog('FINISHED!')
		return INSTANCES_JSON;
	})

	.then(async INSTANCES_JSON => {
		// 0. Statistics
		let tree = await fetch("https://p1.a9z.dev/api/notes/create", {
			method: "POST",
			body: JSON.stringify({
				i: process.env.MK_TOKEN,
				text: `JoinMisskey instance api is updated at ${INSTANCES_JSON.date.toISOString()}.

Total Notes: ${INSTANCES_JSON.stats.notesCount}
Total Users: ${INSTANCES_JSON.stats.usersCount}
Total MAU: ${INSTANCES_JSON.stats.mau}
Total Instances: ${INSTANCES_JSON.stats.instancesCount}

https://join.misskey.page/\n#bot #joinmisskeyupdate`,
			}),
			headers: {
				"Content-Type": "application/json"
			}
		}).then(res => res.json());

		// Instances
		const sorted = INSTANCES_JSON.instancesInfos.sort((a, b) => (b.value - a.value));

		const getInstancesList = instances => instances.map(
			(instance, i) =>
				`${i + 1}. ?[${
					(specifiedName || instance.meta.name !== instance.url) ?
						`${instance.meta.name} (${instance.url})` :
						instance.url
				}](https://${instance.url})`
		).join('\n')

		// 1. Japanese
		const japaneseInstances = [];

		for (const instance of sorted) {
			if (instance.langs.includes("ja")) {
				japaneseInstances.push(instance)
			}
			if (japaneseInstances.length === 30) break;
		}

		tree = await fetch("https://p1.a9z.dev/api/notes/create", {
			method: "POST",
			body: JSON.stringify({
				i: process.env.MK_TOKEN,
				text: `日本語インスタンス (トップ30)\n\n${getInstancesList(japaneseInstances)}`,
				replyId: tree.createdNote.id,
			}),
			headers: {
				"Content-Type": "application/json"
			}
		}).then(res => res.json());

		// 2. English
		const otherInstances = [];

		for (const instance of sorted) {
			if (instance.langs.includes("ja")) continue;
			otherInstances.push(instance);
			if (otherInstances.length === 30) break;
		}

		tree = await fetch("https://p1.a9z.dev/api/notes/create", {
			method: "POST",
			body: JSON.stringify({
				i: process.env.MK_TOKEN,
				text: `Top 30 instances (other than Japanese)\n\n${getInstancesList(otherInstances)}`,
				replyId: tree.createdNote.id,
			}),
			headers: {
				"Content-Type": "application/json"
			}
		}).then(res => res.json());

	})

	.then(async () => {
		const notIncluded = await instanceq()
		if (notIncluded.length === 0) return;

		return fetch("https://p1.a9z.dev/api/notes/create", {
			method: "POST",
			body: JSON.stringify({
				i: process.env.MK_TOKEN,
				text: `JoinMisskey instance api is now updated.\nUNLISTED INSTANCE(S) FOUND! @aqz\n\n${notIncluded.join('\n')}\n#bot`
			}),
			headers: {
				"Content-Type": "application/json"
			}
		})
	})
