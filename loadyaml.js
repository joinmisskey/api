import { load } from "js-yaml"
import * as fs from "node:fs"

export default filepath => load(fs.readFileSync(filepath))
