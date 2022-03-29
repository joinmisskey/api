const fetch = require("node-fetch")

const loadyaml = require("./loadyaml")

const mylist = loadyaml("./data/instances.yml")
const ignorehosts = loadyaml("./data/ignorehosts.yml")

const duplicated = mylist.filter((e, i, arr) => arr.findIndex(x => x.url === e.url) !== i)
	.map(e => e.url)

if (duplicated.length > 0) console.log(`Duplicated:\n  ${duplicated.join(",\n  ")}\n`);
else console.log("Duplicated:\n  There is no duplicated instance!\n");

module.exports = async () => {
	console.log(`Get Instances from misskey.io`);

	const notIncluded = new Set();
	const apinum = 60
	let next = true
	let offset = 0

	while (next) {
		const body = {
			sort: "+pubSub",
			limit: apinum + 1,
			// notResponding: false,
			offset
		}

		const hrstart = process.hrtime()

		const l = await fetch("https://misskey.io/api/federation/instances", {
			method: 'POST',
			body: JSON.stringify(body),
			headers: {
				'Content-Type': 'application/json'
			}
		}).then(async res => {
			const hrend = process.hrtime(hrstart)
			console.log(body, hrend[0], hrend[1] / 1000000)

			const text = await res.text()
			if (!text.startsWith("{") && !text.startsWith("[")) {
				throw Error(text)
			}

			return JSON.parse(text)
		})

		next = l.length === apinum + 1

		if (next) l.pop();
		for (const e of l) {
			if (
				!ignorehosts.some(x => x === e.host) &&
				e.softwareName === 'misskey' &&
				(e.latestStatus === null || e.isNotResponding === false) &&
				!mylist.some(x => x.url === e.host)
			) {
				notIncluded.add(e.host);
			}
		}

		offset += apinum
	}

	return Array.from(notIncluded)
}
