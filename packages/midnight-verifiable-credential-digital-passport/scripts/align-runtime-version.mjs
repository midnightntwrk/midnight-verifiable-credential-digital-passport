// This file is part of midnightntwrk/midnight-verifiable-credential-digital-passport.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Rewrites the `checkRuntimeVersion('x.y.z')` call emitted by the compact
// compiler in the generated managed code so it pins the actually-installed
// `@midnight-ntwrk/compact-runtime` version. The compiler emits the runtime
// version it was built against, which can lag the published runtime this
// package depends on; aligning the call guarantees the generated module
// enforces the same runtime the rest of the package loads.
//
// Adapted from the monorepo prototype: the version is resolved from this
// package's own manifest via createRequire, which is robust under pnpm's
// symlinked node_modules layout (the runtime is not hoisted to the workspace
// root).

import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");

const require = createRequire(path.join(packageRoot, "package.json"));
const runtimeVersion = require("@midnight-ntwrk/compact-runtime/package.json").version;

const targetFile = path.join(
  packageRoot,
  "src",
  "managed",
  "digital-passport-credential",
  "contract",
  "index.js",
);

const source = await readFile(targetFile, "utf8");
const next = source.replace(
  /checkRuntimeVersion\('\d+\.\d+\.\d+'\);/,
  `checkRuntimeVersion('${runtimeVersion}');`,
);
if (next !== source) {
  await writeFile(targetFile, next, "utf8");
  console.info(`Aligned managed runtime version to ${runtimeVersion}`);
}
