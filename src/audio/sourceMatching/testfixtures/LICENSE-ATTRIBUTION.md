# Iowa MIS acoustic audio test fixtures

Copyright/source attribution: Lawrence Fritts / University of Iowa Electronic Music Studios, Musical Instrument Samples (MIS). Source: https://theremin.music.uiowa.edu/MIS.html. The publisher permits download and unrestricted use in projects. Publisher's relevant permission: “may be downloaded and used for any projects, without restrictions”. This is first-party permission, not a Creative Commons or code-license designation.

- `iowa-flute-first8s.wav`: first eight seconds of the non-vibrato mezzo-forte C5–B5 flute recording; Sonja Feig, April 2000. Recording documentation and direct download links: https://theremin.music.uiowa.edu/MISflute.html.
- `iowa-marimba-C7.wav`: entire yarn-mallet mezzo-forte C7 marimba recording; Andrew Thierauf, March 20, 2013. Recording documentation and direct download links: https://theremin.music.uiowa.edu/Mismarimba.html.

The WAVs are derived from the publisher's original AIFF files with the installed ffmpeg, converted to 16-bit PCM while preserving sample rate and channels. The flute is cropped to eight seconds; the marimba remains complete. `provenance.json` records exact original URLs and hashes, derived hashes/formats, recording details, permission source, and the marimba webpage/file sample-rate discrepancy. The two WAVs together occupy 1,590,516 bytes. Only these minimal audio copies and provenance are needed by default CI tests, which run entirely offline.

These are documented acoustic instrument references, not verified synth/plugin/preset recordings. No brand or preset truth is inferred. Original AIFFs and source-page snapshots remain separately available in local artifacts, but CI does not depend on that ignored directory.

Reviewed against publisher pages on 2026-10-03. `realReferences.test.ts` fails if required fixture files are missing or their hashes do not match; it does not silently skip.
