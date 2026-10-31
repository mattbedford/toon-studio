# Vendored libraries

Everything the browser loads comes from this folder. Nothing is fetched from a
CDN, ever. To upgrade a library: download the release, verify it, replace the
files, update this table, and say so in the commit message.

| Library | Version | File | Licence | SHA-256 |
|---|---|---|---|---|
| PixiJS | 8.22.0 | pixi/pixi.min.js | MIT (pixi/LICENSE) | 06d9ef9823e743518793083c296d801e752db128cb1f519fbabe37e1259567ea |
| PixiJS unsafe-eval add-on | 8.22.0 | pixi/unsafe-eval.min.js | MIT (pixi/LICENSE) | 80d5eabed0e1286e2f646b272687170d9211ecd1c901b3382c2d5274ba2c42a9 |

Sources:

- PixiJS: npm package `pixi.js@8.22.0`, files `dist/pixi.min.js` and
  `dist/packages/unsafe-eval.min.js`, from
  https://registry.npmjs.org/pixi.js/-/pixi.js-8.22.0.tgz
  (tarball SHA-256 33a0481e8ae3eb33216c4c8db6a43722c04fa8872ca2cfc7878567fced658ca3).

Why the classic (global `PIXI`) build and not the module build: the page's
Content-Security-Policy forbids `eval` and `new Function`, which PixiJS uses
by default to generate shader-uniform code. The add-on swaps in plain-function
versions of that code. It only ships as a classic script that attaches to the
global, so both files are loaded with ordinary script tags before the app.

Verify at any time:

```
cd web/vendor && sha256sum -c <(awk -F'|' '/^\| [A-Za-z]/ && !/Library/ {gsub(/ /,"",$4); gsub(/ /,"",$6); print $6"  "$4}' VENDOR.md)
```
