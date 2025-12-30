import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import glog from 'fancy-log'
import sharp from 'sharp'
import { sharpBmp } from '@misskey-dev/sharp-read-bmp'
import { fileTypeFromFile } from 'file-type'
import { createHash } from 'node:crypto'
import { mkdirp } from 'mkdirp'
import Queue from 'promise-queue'
import AbortController from 'abort-controller'
import fetch from 'node-fetch';

import { getInstancesInfos } from './getInstancesInfos.js'
import instanceq from './instanceq.js'
import loadyaml from './loadyaml.js'

function getHash(data, a, b, c) {
	const hashv = createHash(a)
	hashv.update(Buffer.from(data), b)
	return hashv.digest(c)
}

async function downloadTemp(name, url, tempDir, alwaysReturn) {
	function clean() {
		fs.unlink(`${tempDir}${name}`, () => null)
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
				"User-Agent": "JoinMisskey/0.1.0; +https://join.misskey.page/instances"
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

	const local = await fsp.readFile(`${tempDir}${name}`).catch(() => null)
	if (!local) {
		return safeWriteFile(name, data, "created")
	}
	if (getHash(data, "sha384", "binary", "base64") !== getHash(local, "sha384", "binary", "base64")) {
		await fsp.unlink(`${tempDir}${name}`).catch(() => null)
		return safeWriteFile(name, data, "renewed")
	}
	if (alwaysReturn) return { name, status: "unchanged" }
	return false
}

getInstancesInfos()
	.then(async ({alives, deads, notMisskey, outdated, versions, versionOutput, langs, latestMisskeyStableVersion, latestMisskeyVersion}) => {
		fs.writeFile('./dist/versions.json', JSON.stringify(versionOutput), () => { })

		const stats = alives.reduce((prev, v) => (v.nodeinfo.usage && v.nodeinfo.usage.users) ? {
			  notesCount: (v.nodeinfo.usage.localPosts || 0) + prev.notesCount,
			  usersCount: (v.nodeinfo.usage.users.total || 0) + prev.usersCount,
			  npd15: (v.npd15 || 0) + prev.npd15,
			  druYesterday: (v.druYesterday || 0) + prev.druYesterday,
			  dru15: (v.dru15 || 0) + prev.dru15,
			  instancesCount: 1 + prev.instancesCount
		  } : { ...prev }, {
			notesCount: 0,
			usersCount: 0,
			npd15: 0,
			druYesterday: 0,
			dru15: 0,
			instancesCount: 0
		})

		fs.writeFile('./dist/alives.txt', alives.map(v => v.url).join('\n'), () => { })
		fs.writeFile('./dist/deads.txt', deads.map(v => v.url).join('\n'), () => { })
		fs.writeFile('./dist/not-misskey.txt', notMisskey.map(v => v.url).join('\n'), () => { })
		//fs.writeFile('./dist/outdated.txt', outdated.map(v => v.url).join('\n'), () => { })

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
						const filename = `./temp/instance-icons/${res.name}`
						const { mime } = await fileTypeFromFile(filename)
						const base = (await sharpBmp(filename, mime))
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
			stats: stats,
			langs,
			latestMisskeyVersion,
			latestMisskeyStableVersion,
			instancesInfos: alives
		}

		fs.writeFile('./dist/instances.json', JSON.stringify(INSTANCES_JSON), () => { })

		//#region remove dead/ignored servers' assets
		try {
			const targets = new Set();
			deads.forEach(v => targets.add(v.url))
			notMisskey.forEach(v => targets.add(v.url))
			loadyaml("./data/ignorehosts.yml").forEach(v => targets.add(v))
			targets.forEach(v => {
				fs.globSync(`./dist/**/${v}.*`).forEach(file => {
					glog(`removing ${file}`)
					fs.unlink(file, () => null)
				})
				fs.globSync(`./temp/**/${v}`).forEach(file => {
					glog(`removing ${file}`)
					fs.unlink(file, () => null)
				})
			})
		} catch (e) {
			glog.error(e)
		}
		//#endregion

		glog('FINISHED!')
		return INSTANCES_JSON;
	})

	.then(async INSTANCES_JSON => {
		// 0. Statistics
		let tree = await fetch("https://p1.a9z.dev/api/notes/create", {
			method: "POST",
			body: JSON.stringify({
				i: process.env.MK_TOKEN,
				text: `JoinMisskey servers api is updated at ${INSTANCES_JSON.date.toISOString()}.
\`\`\`
Total Notes   : ${INSTANCES_JSON.stats.notesCount}
Total Users   : ${INSTANCES_JSON.stats.usersCount}
Total Servers : ${INSTANCES_JSON.stats.instancesCount}
Daily Read Users   : ${INSTANCES_JSON.stats.druYesterday}
DRU Avg.  (15 days): ${Math.round(INSTANCES_JSON.stats.dru15)}
Notes/d Avg. (15 days): ${Math.round(INSTANCES_JSON.stats.npd15)}
\`\`\`
https://misskey-hub.net/servers\n#bot #joinmisskeyupdate`,
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
					(instance.name || instance.name !== instance.url) ?
						`<plain>${instance.name}</plain> (${instance.url})` :
						instance.url
				}](https://${instance.url})`
		).join('\n');

		const specifiedListLangs = [
			["ja", "日本語サーバー (トップ30)"],
			["ko", "한국어 서버 (상위 30개)"],
			["zh", "中文服务器 (前30名)"],
		];

		for (const [lang, listTitle] of specifiedListLangs) {
			const specifiedInstances = [];
	
			for (const instance of sorted) {
				if (instance.langs.includes(lang)) {
					specifiedInstances.push(instance)
				}
				if (specifiedInstances.length === 30) break;
			}
	
			tree = await fetch("https://p1.a9z.dev/api/notes/create", {
				method: "POST",
				body: JSON.stringify({
					i: process.env.MK_TOKEN,
					text: `${listTitle}\n\n${getInstancesList(specifiedInstances)}`,
					replyId: tree.createdNote.id,
				}),
				headers: {
					"Content-Type": "application/json"
				}
			}).then(res => res.json());
		}

		// other than specified langs
		const otherInstances = sorted.reduce((acc, instance) => {
			if (acc.length > 30) return acc;

			for (const [lang] of specifiedListLangs) {
				if (instance.langs.includes(lang)) return acc;
			}
			acc.push(instance);
			return acc;
		}, []);

		tree = await fetch("https://p1.a9z.dev/api/notes/create", {
			method: "POST",
			body: JSON.stringify({
				i: process.env.MK_TOKEN,
				text: `Top 30 instances (other than ja, ko or zh)\n\n${getInstancesList(otherInstances)}`,
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
		fs.writeFile('./dist/notincluded.txt', notIncluded.join('\n'), () => { })
		return fetch("https://p1.a9z.dev/api/notes/create", {
			method: "POST",
			body: JSON.stringify({
				i: process.env.MK_TOKEN,
				text: `JoinMisskey servers api is now updated.\nUNLISTED INSTANCE(S) FOUND!\n\n${notIncluded.join('\n')}\n#bot`
			}),
			headers: {
				"Content-Type": "application/json"
			}
		})
	})
