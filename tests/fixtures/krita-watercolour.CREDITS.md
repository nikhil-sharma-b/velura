# Krita watercolour import fixture

`krita-watercolour.kpp` is an unmodified copy of
`paintoppresets/j)_Watercolor_Texture.kpp` from **Krita 4 Default Resources**.
It is a real Krita pixel-brush (`paintbrush`) preset, not a synthetic
watercolour engine. Its companion `watercolor.gih` tip is already represented
by Velura's shipped `krita:watercolor` textures.

- Repository: <https://invent.kde.org/graphics/krita>
- Pinned commit: `97f42ad6326a3cfc15d7f158678433608acf13ce`
- Bundle: `krita/data/bundles/Krita_4_Default_Resources.bundle`
- Download: <https://invent.kde.org/graphics/krita/-/raw/97f42ad6326a3cfc15d7f158678433608acf13ce/krita/data/bundles/Krita_4_Default_Resources.bundle>
- Fixture SHA-256: `25751c180666cba22ac253a5a7835c40f6ce06dd91bed59f71fe60da4dbebd52`
- Licence: **CC0** (<https://creativecommons.org/publicdomain/zero/1.0/>).
  The bundle's `meta.xml` declares `license="CC-0"` (a `meta-userdefined`
  entry with `meta:name="license"` and `meta:value="CC-0"`).
- Bundle attribution: **Deevad with derivations of the brushes of Ramon
  Miranda, Razvanc, Radian, Wolthera, Storm, Scottyp and other.**
  This is the bundle's attribution, not a claim of individual authorship of
  this preset. CC0 does not require attribution; we retain it as provenance.

Extract the named entry from the pinned bundle without reserializing it to
reproduce the fixture. No Krita application source code is included.

Tests establish that the preset imports as an editable Velura fluid adaptation
and keeps compatible source settings. They do not claim visual equivalence to
Krita, nor a translation of source water/drying/bleed simulation parameters.
