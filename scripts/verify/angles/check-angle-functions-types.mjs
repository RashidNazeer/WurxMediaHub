#!/usr/bin/env node
/**
 * Do the Categorise Edge Functions type-check?
 *
 * There is no Deno on a laptop here, and `supabase functions deploy` does not
 * type-check, so a function could be deployed with an error that TypeScript
 * would have named in a second. It happened on 2026-10-30: `body.brand.trim()`
 * ran on a request that has no brand (`queue.list`), threw OUTSIDE the try block,
 * and the platform answered with a bare 500. A browser reports a 500 with no CORS
 * headers as "the service did not answer", which looks like a deployment or
 * network problem and sends everybody looking in the wrong place.
 *
 * This runs `tsc` over the two functions against the real zod and supabase-js
 * types, with a two line stub for the `Deno` global. The `npm:` specifiers are
 * mapped to node_modules, which carries the same versions.
 *
 * Run: pnpm verify:angle-functions
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'angle-fn-types-'));
const files = [
  'supabase/functions/collab-angles/index.ts',
  'supabase/functions/collab-angles-sync/index.ts',
].map((f) => resolve(root, f));

writeFileSync(
  join(dir, 'deno-stub.d.ts'),
  'declare const Deno: { env: { get(k: string): string | undefined }; ' +
    'serve(h: (req: Request) => Response | Promise<Response>): unknown };\n',
);
writeFileSync(
  join(dir, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      ignoreDeprecations: '6.0',
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      lib: ['ES2022', 'DOM'],
      types: [],
      baseUrl: root,
      paths: {
        'npm:@supabase/supabase-js@2.110.9': ['node_modules/@supabase/supabase-js'],
        'npm:zod@4.4.3': ['node_modules/zod'],
      },
    },
    files: [join(dir, 'deno-stub.d.ts'), ...files],
  }),
);

const tsc = resolve(root, 'node_modules/typescript/bin/tsc');
const r = spawnSync(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' });
const out = `${r.stdout}${r.stderr}`.split('\n').filter((l) => l.trim() && !/^\s*Visit /.test(l));

if (r.status === 0) {
  console.log(`  PASS  ${files.length} Edge Functions type-check`);
  process.exit(0);
}
console.log(out.slice(0, 40).join('\n'));
console.log(`\n  FAIL  ${out.filter((l) => /error TS/.test(l)).length} type error(s)`);
process.exit(1);
