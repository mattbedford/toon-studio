# Vendored libraries

Everything the browser loads comes from this folder. Nothing is fetched from a
CDN, ever. To upgrade a library: download the release, verify it, replace the
files, update this table, and say so in the commit message.

| Library | Version | File | Licence | SHA-256 |
|---|---|---|---|---|
| PixiJS | 8.22.0 | pixi/pixi.min.mjs | MIT (pixi/LICENSE) | 66257bc46776898bf8c54daaed402ed8f9ac109379c47b2dfa8aa048544d2953 |

Sources:

- PixiJS: npm package `pixi.js@8.22.0`, file `dist/pixi.min.mjs`, from https://registry.npmjs.org/pixi.js/-/pixi.js-8.22.0.tgz (tarball SHA-256 33a0481e8ae3eb33216c4c8db6a43722c04fa8872ca2cfc7878567fced658ca3).

Verify at any time:

```
cd web/vendor && sha256sum -c <(awk -F'|' '/^\| [A-Za-z]/ && !/Library/ {gsub(/ /,"",$4); gsub(/ /,"",$6); print $6"  "$4}' VENDOR.md)
```
