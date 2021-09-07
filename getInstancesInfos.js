const fs = require("fs")
const glog = require("fancy-log")
const semver = require("semver")
const fetch = require("node-fetch").default
const AbortController = require("abort-controller").default
const extend = require("extend")
const loadyaml = require("./loadyaml")
const Queue = require('promise-queue');

const instances = loadyaml("./data/instances.yml")

const pqueue = new Queue(32)

function safePost(url, options) {
	const controller = new AbortController()
	const timeout = setTimeout(
		() => { controller.abort() },
		60000
	)
	// glog("POST start", url)
	return fetch(url, extend(true, options, { method: "POST", signal: controller.signal })).then(
		res => {
			// glog("POST finish", url)
			if (res && res.ok) return res
			return false
		},
		e => {
			// glog("POST failed", url, e.errno, e.type)
			return false
		}
	).finally(() => {
		clearTimeout(timeout)
	})
}

async function postJson(url, json) {
	return pqueue.add(() => safePost(url, (json ? {
		body: JSON.stringify(json),
		headers: {
			"Content-Type": "application/json",
			"User-Agent": "LuckyBeast"
		},
		redirect: "error"
	} : {
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "LuckyBeast"
			},
			redirect: "error"
		}))
		.then(res => (!res ? false : res.json()))
		.catch(e => {
			glog.error(url, e)
			return false
		})
	)
}

const ghRepos = ["mei23/misskey", "syuilo/misskey", "mei23/misskey-v11", "TeamBlackCrystal/misskey"];

module.exports.ghRepos = ghRepos;

async function getVersions() {
	glog("Getting Misskey Versions")
	const maxRegExp = /<https:\/\/.*?>; rel="next", <https:\/\/.*?\?page=(\d+)>; rel="last"/;
	const versions = new Map();
	const versionOutput = {};
	const headers = {
		"User-Agent": "LuckyBeast",
		Authorization: `bearer ${process.env.LB_TOKEN}`
	};

	const vqueue = new Queue(3)

	for (const repo of ghRepos) {
		glog(repo, "Start")
		const res1 = await fetch(`https://api.github.com/repos/${repo}/releases`, { headers })
		const link = res1.headers.get("link")
		const max = link && Math.min(Number(maxRegExp.exec(link)[1]), repo === "syuilo/misskey" ? 99999 : 3)

		const resp = (await Promise.all([Promise.resolve(res1), ...(!link ? []
			: Array(max - 1).fill()
				.map((v, i) => `https://api.github.com/repos/${repo}/releases?page=${i + 2}`)
				.map(url => vqueue.add(() => fetch(url, { headers }))))]

			.map((resa, i) => resa.then(
				res => res.json(),
				e => {
					glog(repo, "Error(fetch)", e)
					return Promise.resolve([])
				}
			).then(
				json => json.map((release, j) => {
					// glog("Misskey Version", release.tag_name)
					versions.set(semver.clean(release.tag_name, { loose: true }), {
						repo,
						count: (i - 1) * 30 + j,
					})
					return release.tag_name
				}),
				e => {
					glog(repo, "Error(json)", e)
					return Promise.resolve([])
				}
			).catch(e => { throw Error(e) })
			
			))).flat(1)

		versionOutput[repo] = resp;
		glog(repo, "Finish", resp.length)
	}

	glog("Got Misskey Versions")
	return { versions, versionOutput }
}

module.exports.getInstancesInfos = async function() {
	glog("Getting Instances' Infos")

	const metasPromises = []
	const statsPromises = []
	const NoteChartsPromises = []
	const alives = [], deads = []

	const { versions, versionOutput } = await getVersions()

	// eslint-disable-next-line no-restricted-syntax
	for (let t = 0; t < instances.length; t += 1) {
		const instance = instances[t]
		metasPromises.push(postJson(`https://${instance.url}/api/meta`))
		statsPromises.push(postJson(`https://${instance.url}/api/stats`))
		NoteChartsPromises.push(postJson(`https://${instance.url}/api/charts/notes`, { span: "day" }))
	}

	const interval = setInterval(() => {
		glog(`${pqueue.getQueueLength()} requests remain and ${pqueue.getPendingLength()} requests processing.`)
	}, 1000)

	const [
		metas,
		stats,
		NoteCharts,
	] = await Promise.all([
		Promise.all(metasPromises),
		Promise.all(statsPromises),
		Promise.all(NoteChartsPromises)
	])

	clearInterval(interval)

	for (let i = 0; i < instances.length; i += 1) {
		const instance = instances[i]
		const meta = metas[i] || false
		const stat = stats[i] || false
		const NoteChart = NoteCharts[i] || false
		if (meta && stat && NoteChart) {
			delete meta.emojis;
			delete meta.announcements;

			const version = semver.clean(meta.version, { loose: true })

			//#region security
			if (
				// syuilo
				semver.satisfies(version, '< 12.90.0') ||
				semver.satisfies(version, '< 12.51.0') ||
				semver.satisfies(version, '>= 10.46.0 < 10.102.4 || >= 11.0.0-alpha.1 < 11.20.2') ||
				// mei23
				semver.satisfies(version, '< 10.102.338-m544') ||
				// mei23-v11
				semver.satisfies(version, '< 11.37.1-20210825162615') ||
				// TeamBlackCrystal
				semver.satisfies(version, '< 11.37.1-rei0784-5.15.1')
			) {
				continue
			}
			//#endregion

			const versionInfo = (() => {
				const sem1 = semver.clean(meta.version, { loose: true })
				if (versions.has(sem1)) return versions.get(sem1);
				const sem2 = semver.valid(semver.coerce(meta.version))
				let current = { repo: 'syuilo/misskey', count: 1500 };
				for (const [key, value] of versions.entries()) {
					if (sem1 && sem1.startsWith(key)) {
						if (value.count === 0) return value;
						else if (current.count >= value.count ) current = value;
					} else if (sem2 && sem2.startsWith(key)) {
						if (value.count === 0) return value;
						else if (current.count >= value.count ) current = value;
					}
				}
				return current
			})()

			/*   インスタンスバリューの算出   */
			let value = 0
			// 1. バージョンのリリース順をもとに並び替え
			value += 100000 - versionInfo.count * 7200

			// (基準値に影響があるかないか程度に色々な値を考慮する)
			if (NoteChart && Array.isArray(NoteChart.local?.inc)) {
				// 2.
				const arr = NoteChart.local?.inc.filter(e => e !== 0).slice(-3)
				// eslint-disable-next-line no-mixed-operators
				if (arr.length > 0) value += arr.reduce((prev, current) => prev + current) / arr.length * 100
			}

			alives.push(extend(true, instance, {
				value,
				meta,
				stats: stat,
				description: meta.description || (instance.description || null),
				langs: instance.langs || ['ja', 'en', 'de', 'fr', 'zh', 'ko', 'ru', 'th', 'es'],
				isAlive: true,
				repo: versionInfo?.repo
			}))
		} else {
			deads.push(extend(true, { isAlive: false, value: 0 }, instance))
		}
	}
	glog("Got Instances' Infos")

	return {
		alives: alives.sort((a, b) => (b.value || 0) - (a.value || 0)),
		deads,
		versions,
		versionOutput,
	}
}
