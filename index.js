const { promisify } = require("util")
const fs = require("fs")
const fetch = require("node-fetch")
const fileType = require("file-type")
const glob = require("glob")
const glog = require("fancy-log")
const sharp = require("sharp")
const { createHash } = require("crypto")
const mkdirp = require('mkdirp')

const getInstancesInfos = require('./getInstancesInfos')
const instanceq = require('./instanceq')

const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)

function getHash(data, a, b, c) {
	const hashv = createHash(a)
	hashv.update(data, b)
	return hashv.digest(c)
}

async function downloadTemp(name, url, tempDir, alwaysReturn) {
	mkdirp.sync(tempDir)
	const files = glob.sync(`${tempDir}${name}.*`)
	if (files.length > 0) {
		// glog("Getting image: " + url)
		const request = await fetch(url, { encoding: null }).catch(() => false)
		if (!request) {
			console.error(url)
			return false
		}
		if (!request.ok) {
			console.error(url, await request.text())
			return false
		}
		const remote = await request.buffer()
		if (!remote) return false
		let { ext } = await fileType.fromBuffer(remote)
		const local = await readFile(`${tempDir}${name}.${ext}`).catch(() => false)
		if (!local) return false
		if (getHash(remote, "sha384", "binary", "base64") !== getHash(local, "sha384", "binary", "base64")) {
			await writeFile(`${tempDir}${name}.${ext}`, remote)
			return { name, ext, status: "renewed" }
		}
		if (alwaysReturn) return { name, ext, status: "unchanged" }
		return false
	}

	glog(`Getting new image: ${url}`)
	return fetch(url, { encoding: null }).then(async request => {
		if (!request.ok) {
			glog.error(url, await request.text())
			return false
		}

		const data = request.buffer()
		let { ext } = await fileType.fromBuffer(data)
		await writeFile(`${tempDir}${name}.${ext}`, data)
		return { name, ext, status: "created" }
	}).catch(reason => {
		glog(`Cannot get the image: ${name}`, reason)
		return false
	})
}

getInstancesInfos()
	.then(async instancesInfos => {
		const stats = instancesInfos.reduce((prev, v) => {
			if (!v.isAlive) return prev
		
			return {
			  notesCount: v.stats.originalNotesCount + prev.notesCount,
			  usersCount: v.stats.originalUsersCount + prev.usersCount,
			  instancesCount: 1 + prev.instancesCount
			}
		  }, { notesCount: 0, usersCount: 0, instancesCount: 0 })

		fs.writeFile('./dist/instances.json', JSON.stringify({ stats, instancesInfos }), () => { })

		const results = await Promise.all(instancesInfos
			.filter(instance => instance.isAlive && instance.meta.bannerUrl)
			.map(instance => downloadTemp(`${instance.url}`, (new URL(instance.meta.bannerUrl, `https://${instance.url}`)).toString(), `./temp/instance-banners/`, true)))

		await mkdirp('./dist/instance-banners')

		await Promise.all(
			results.filter(v => v && v.status !== "unchanged")
				.map(async v => {
					const base = await (async () => {
						try {
							return await sharp(`./temp/instance-banners/${v.name}.${v.ext}`)
								.resize({
									width: 1024,
									withoutEnlargement: true,
								})
						} catch (e) {
							glog.error(e)
							return;
						}
					})
					if (!base) return;
					await base.jpeg({ quality: 80, progressive: true })
						.toFile(`./dist/instance-banners/${v.name}.jpeg`)
					await base.webp({ quality: 75 })
						.toFile(`./dist/instance-banners/${v.name}.webp`)
					return;
				})
		)

		console.log('FINISHED!')
		return;
	})
	.then(async () => {
		const notIncluded = await instanceq()
		if (!notIncluded.length === 0) return;
		return fetch("https://c2.a9z.dev/api/notes/create", {
			method: "POST",
			body: JSON.stringify({
				i: process.env.MK_TOKEN,
				text: `@aqz UNLISTED INSTANCE(S) FOUND!\n\n${notIncluded.map(e => e.host).join('\n')}`
			}),
			headers: {
				"Content-Type": "application/json"
			}
		})
	})
