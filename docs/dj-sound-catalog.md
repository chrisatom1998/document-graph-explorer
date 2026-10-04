# DJ sound category catalog

Version 1: 192 categories. This is a curated music-production vocabulary, not a complete enumeration of all possible audio.

## Recognition status

Every category has a bundled 512-dimensional music-trained CLAP description vector and is available for matching, review and export. All categories are marked **experimental**: prompt coverage and automated tests establish that the app can attempt recognition, not that it is accurate. A score is a similarity, not a probability. An unknown result is intentional. No new supervised model has been trained.

New source comparisons are timbral source estimates, not proof of the original instrument or preset. Strong AudioSet source evidence takes priority. Production families compete independently; their closest alternatives and unrelated sound descriptions must be beaten before a tag is accepted. Silence is suppressed by the audio pipeline. New families require similarity >= 0.40 (0.35 for character) and a margin >= 0.05. Legacy 16 production types retain their existing selection logic; breath retains its dedicated confusing alternatives and >= 0.45 threshold. These thresholds are provisional and require held-out calibration.

## Sources and scope

Catalog assembled from the kinds of tags exposed by these catalogs, expanded with curated instrument and production definitions. It is not a bulk export of any provider's private taxonomy. Sources checked October 2, 2026:

- [Splice sample catalog](https://splice.com/sounds/search/samples)
- [Splice Vocal FX](https://splice.com/sounds/collections/fIoGPyTvuYcws1kNFLHcYr-I6no/samples)
- [Loopcloud](https://www.loopcloud.com/cloud/features)
- [AudioSet ontology](https://research.google.com/audioset/ontology/)

Genres, BPM, musical key, filename labels, plugin/preset identities and loop/one-shot packaging are separate metadata, not additional sound detections. No copyrighted sample library was downloaded or included.

## Evaluate and improve

1. Import audio, run Full analysis, and use Track actions → Correct DJ tags. The category search accepts names and aliases.
2. Export reviewed tracks as collection JSON.
3. Run `node scripts/evaluate-dj-tags.mjs collection.json`. The report includes precision, recall and example counts per category, with untested categories explicitly listed.
4. Keep development and held-out collections separate. A few same-pack recordings cannot establish general accuracy.
5. Use labeled failures to decide which category needs calibrated thresholds or supervised training. Reviewed labels do not retrain the model automatically.

For a local audio smoke test, run `npx vite-node src/dev/classifyDjAudio.ts -- /absolute/path/sample.wav`. Requires FFmpeg and the cached CLAP model. Only the first ten seconds are tested; the app's Full mode additionally scans overlapping windows. No file names are given to the model. This creates `artifacts/music-evaluation/dj-catalog-smoke.json` with tags and embeddings, not an accuracy claim.

## Validation of this expansion

All 192 categories have finite matching vectors in the shipped model asset. Tests cover mixed-category retention, unknown alternatives across Full-mode windows, alias handling, correction search and existing audio behavior. A native local CLAP smoke test processed the first ten seconds of all 16 supplied Shadow UK melodic loops. That test exercises audio inference but has no independent ground-truth labels and cannot establish category-level accuracy. The report is saved at `artifacts/music-evaluation/dj-catalog-smoke.json`. No supervised training was performed.

## Categories

### Source (59)

| Category | Family | Description | Aliases |
|---|---|---|---|
| voice | sources | A human voice speaking or singing. | vox, vocals |
| breath | sources | A person audibly inhaling or exhaling. | breathing |
| synthesizer | sources | Electronic synthesized musical tones. | synth |
| guitar | sources | A guitar playing plucked or strummed musical notes. | — |
| piano | sources | An acoustic piano playing struck musical notes. | — |
| drums | sources | A drum kit or drum machine playing percussion. | — |
| sound effect | sources | A designed transition, impact or special sound effect. | fx, sfx |
| noise | sources | A burst of synthetic white noise. | — |
| electric piano | sources | An electric piano playing soft bell-like keyboard notes. | rhodes |
| acoustic guitar | sources | An acoustic guitar with resonant plucked strings. | — |
| electric guitar | sources | An amplified electric guitar playing musical notes. | — |
| bass guitar | sources | A bass guitar playing low plucked string notes. | — |
| strings | sources | An ensemble of bowed string instruments. | — |
| violin / fiddle | sources | A violin playing high bowed musical notes. | violin, fiddle |
| cello | sources | A cello playing low resonant bowed notes. | — |
| trumpet | sources | A trumpet playing bright brassy musical notes. | — |
| saxophone | sources | A saxophone playing reedy musical notes. | — |
| flute | sources | A flute playing airy pitched musical notes. | — |
| clarinet | sources | A clarinet playing hollow woody reed tones. | — |
| organ | sources | An organ playing sustained keyboard chords. | — |
| bell | sources | A bell ringing with metallic resonant tones. | — |
| mallet instrument | sources | A marimba, vibraphone or xylophone playing struck pitched notes. | — |
| percussion | sources | Unpitched percussion instruments playing a rhythm. | — |
| hand percussion | sources | Hand drums, shakers or tambourines playing a rhythm. | — |
| foley | sources | Close recorded everyday object movements, contacts and handling sounds. | — |
| environmental sound | sources | Outdoor or indoor environmental ambience. | field recording |
| turntable | sources | A DJ turntable scratching a vinyl record. | — |
| harp | sources | A harp playing resonant plucked string notes. | — |
| trombone | sources | A trombone playing low sliding brass notes. | — |
| horn | sources | A horn playing rounded brassy sustained notes. | — |
| tuba | sources | A tuba playing very low resonant brass notes. | — |
| oboe | sources | An oboe playing narrow nasal double reed tones. | — |
| bassoon | sources | A bassoon playing low woody double reed tones. | — |
| harmonica | sources | A harmonica playing breath driven bending reed tones. | — |
| accordion | sources | An accordion playing bellows driven reed chords. | — |
| banjo | sources | A banjo playing bright twangy plucked strings. | — |
| ukulele | sources | A small ukulele playing light strummed or plucked chords. | — |
| sitar | sources | A sitar playing buzzing resonant plucked notes. | — |
| mandolin | sources | A mandolin playing bright short plucked notes. | — |
| steel guitar | sources | A steel guitar playing smooth sliding string tones. | — |
| double bass | sources | A double bass playing low resonant plucked or bowed notes. | — |
| viola | sources | A viola playing midrange bowed string notes. | — |
| xylophone | sources | A xylophone playing short woody struck pitched notes. | — |
| marimba | sources | A marimba playing rounded resonant wooden pitched notes. | — |
| vibraphone | sources | A vibraphone playing sustained metallic pitched notes. | — |
| steel drum | sources | A steelpan playing bright resonant metallic pitched notes. | — |
| glockenspiel | sources | A glockenspiel playing high bright metallic pitched notes. | — |
| kalimba | sources | A kalimba playing soft metallic plucked tine notes. | — |
| tabla | sources | A tabla playing resonant hand drum strokes with changing pitch. | — |
| djembe | sources | A djembe playing hand drum bass and slap tones. | — |
| cajon | sources | A cajon playing woody box drum thumps and snare-like slaps. | — |
| gong | sources | A gong ringing with a deep expanding metallic wash. | — |
| triangle | sources | A triangle ringing with high bright metallic tones. | — |
| jaw harp | sources | A jaw harp making twanging resonant rhythmic tones. | — |
| whistle | sources | A pitched whistle tone produced by a person or whistle instrument. | — |
| animal sound | sources | An animal making calls cries or growls. | — |
| waterphone | sources | An eerie resonant metallic waterphone sound. | — |
| singing bowl | sources | A singing bowl ringing with long resonant metallic tones. | — |
| tuned percussion | sources | Percussion instruments playing identifiable musical pitches. | — |

### Production (100)

| Category | Family | Description | Aliases |
|---|---|---|---|
| vocal chops | vocal | A vocal chop loop. | vox chop, vocal chop, chops |
| vocal phrase | vocal | A human voice singing a melodic vocal phrase. | vocal hook, vocal melody |
| spoken phrase | vocal | A human voice speaking words without singing. | spoken word, dialogue |
| whisper | vocal | A person quietly whispering words. | whispered vocal |
| vocal shout | vocal | A loud short human vocal shout. | shout, yell |
| vocal chant | vocal | Human voices rhythmically chanting repeated syllables. | chant |
| vocal ad-lib | vocal | Short expressive vocal interjections between musical phrases. | adlib, ad-lib |
| vocal hum | vocal | A human voice humming pitched notes with a closed mouth. | humming |
| vocal vowel | vocal | A sustained human voice singing an ah, oh or oo vowel. | vowel, ah, oh |
| choir | vocal | Multiple human voices singing harmonized sustained tones. | choral |
| vocal harmony | vocal | Layered sung voices harmonizing a musical phrase. | harmony vocals |
| vocal scream | vocal | A human voice screaming or shrieking. | scream |
| vocal laugh | vocal | A human voice laughing. | laughter |
| vocal gasp | vocal | A person suddenly gasping audibly. | gasp |
| beatbox | vocal | A human mouth imitating rhythmic drum and percussion sounds. | beatboxing |
| vocoder vocal | vocal | A robotic electronic vocal with articulated syllables and chordal tones. | vocoder |
| pitched vocal | vocal | A sampled human vocal shifted noticeably in pitch. | pitch shifted vocal |
| reversed vocal | vocal | A backward sounding human vocal with swelling reversed syllables. | reverse vocal |
| vocal pad | vocal | Sustained airy human vocal layers forming a background musical texture. | choir pad |
| vocal breath | breath | A vocal breath sample. | breath sample |
| synth pluck | synth | A short electronic synthesizer pluck with a sharp attack and quick decay. | pluck |
| atmospheric pad | synth | A sustained atmospheric synthesizer pad with spacious soft chords. | pad, atmosphere pad |
| synth stab | synth | Short punchy synthesizer chord stabs. | stab, chord stab |
| synth lead | synth | A synthesizer playing a prominent lead melody. | lead |
| synth bass | synth | A deep electronic synth bass line. | — |
| vocal-like synth | synth | An electronic synthesizer with a vowel-like tone imitating a human voice. | formant synth |
| synth arpeggio | synth | Synthesized notes repeating in an ascending or descending arpeggiated sequence. | arp, arpeggio |
| synth chord | synth | A synthesizer playing several musical notes together as chords. | synth chords |
| supersaw | synth | A wide bright layered detuned sawtooth synthesizer playing musical notes. | super saw, detuned saw |
| acid synth | synth | A resonant squelching electronic synthesizer pattern with sliding notes. | 303, acid line |
| bell synth | synth | A synthesizer playing clear metallic bell-like notes. | synth bell |
| organ synth | synth | A synthesizer playing sustained organ-like tones. | — |
| brass synth | synth | A synthesizer playing bright brass-like stabs or melodies. | — |
| string synth | synth | A synthesizer playing layered bowed-string-like tones. | — |
| chiptune synth | synth | A retro video game synthesizer playing square wave or pulse tones. | 8-bit, chiptune |
| fm synth | synth | An electronic synth with bright clangorous metallic tones and complex overtones. | fm |
| synth drone | synth | A sustained electronic tone with little melodic movement. | drone |
| synth sequence | synth | A repeating electronic note sequence forming a musical pattern. | sequence, sequencer |
| sub bass | bass | A very low smooth synthesized bass tone with little high frequency content. | sub |
| reese bass | bass | A low detuned buzzing bass sound with beating and moving overtones. | reese |
| wobble bass | bass | A low synthesized bass with a rhythmic opening and closing filter. | wobble |
| bass growl | bass | A low aggressive distorted bass with growling vowel-like motion. | growl, growl bass |
| acid bass | bass | A low resonant squelching electronic bass pattern with sliding notes. | 303 bass |
| 808 bass | bass | A deep booming pitched bass with a decaying or sliding tone. | 808, 808 sub |
| bass pluck | bass | A short low synthesized bass note with a sharp attack and quick decay. | — |
| foghorn bass | bass | A low loud horn-like electronic bass blast. | foghorn |
| rubbery bass | bass | A low electronic bass with a springy bouncing pitch or filter sound. | — |
| kick | drum-hit | A low thumping bass drum hit. | kick drum, bass drum |
| snare | drum-hit | A sharp noisy snare drum hit. | snare drum |
| clap | drum-hit | A short sharp handclap or electronic clap percussion hit. | handclap |
| closed hi-hat | drum-hit | A short tight closed hi-hat cymbal hit. | closed hat, chh |
| open hi-hat | drum-hit | A ringing open hi-hat cymbal hit. | open hat, ohh |
| ride cymbal | drum-hit | A bright metallic ride cymbal ping with ringing sustain. | ride |
| crash cymbal | drum-hit | A loud crashing cymbal with a long noisy decay. | crash |
| rimshot | drum-hit | A sharp woody snare rimshot or rim click. | rim, rim click |
| tom | drum-hit | A round resonant pitched tom drum hit. | tom drum |
| shaker | drum-hit | A short rattling shaker percussion sound. | — |
| tambourine | drum-hit | A jingling tambourine percussion sound. | — |
| conga | drum-hit | A resonant hand-struck conga drum sound. | — |
| bongo | drum-hit | A high hollow hand-struck bongo drum sound. | — |
| cowbell | drum-hit | A short metallic clanking cowbell hit. | — |
| clave | drum-hit | A short dry woody clave stick hit. | claves |
| woodblock | drum-hit | A hollow woody woodblock percussion hit. | — |
| finger snap | drum-hit | A sharp short human finger snap. | snap |
| percussion hit | drum-hit | A single short percussion hit. | perc hit |
| drum loop | drum-pattern | A rhythmic drum loop with kick, snare and hi hats. | drum groove |
| percussion loop | drum-pattern | A repeating groove of hand percussion and rattling instruments. | perc loop |
| hi-hat loop | drum-pattern | A repeating rhythm of hi-hat cymbals. | hat loop |
| shaker loop | drum-pattern | A repeating rattling shaker percussion rhythm. | — |
| breakbeat | drum-pattern | A syncopated sampled drum break with kick snare and cymbals. | drum break, break |
| drum fill | drum-pattern | A short drum flourish or rolling pattern leading into a transition. | fill |
| snare roll | drum-pattern | Rapid repeating snare drum hits building intensity. | — |
| top loop | drum-pattern | A repeating high percussion groove with cymbals hats and shakers. | tops, tops loop |
| riser | transition | A rising electronic transition effect building in pitch and intensity. | uplifter, upsweep |
| downlifter | transition | A falling electronic transition effect descending in pitch. | downer, downsweep |
| impact | transition | A single dramatic cinematic impact hit. | hit |
| whoosh | transition | A sweeping whoosh sound effect. | swoosh |
| reverse cymbal | transition | A backward cymbal swelling into a sharp ending. | reversed crash |
| reverse impact | transition | A backward impact swelling toward a sudden hit. | — |
| noise sweep | transition | A filtered broadband noise sound sweeping through frequencies. | sweep |
| sub drop | transition | A low booming bass effect falling in pitch. | bass drop |
| laser | transition | A short electronic laser zap with a rapid pitch sweep. | zap |
| siren | transition | An oscillating rising and falling alarm-like tone. | — |
| air horn | transition | A loud brassy compressed-air horn blast. | airhorn |
| vinyl scratch | transition | A DJ rhythmically scratching a vinyl record. | scratch, turntable scratch |
| record stop | transition | Music slowing rapidly in pitch and speed to a stop. | tape stop |
| stutter effect | transition | A sound rapidly retriggered into short repeated fragments. | stutter |
| glitch effect | transition | Short irregular digital clicks cuts and bursts. | glitch |
| reverse effect | transition | A backward sounding effect with a swelling attack and abrupt end. | reverse |
| texture | texture | An atmospheric noise texture and ambient soundscape. | soundscape |
| ambient drone | texture | A continuous low or resonant atmospheric drone. | — |
| vinyl crackle | texture | Small irregular crackles and pops from a vinyl recording. | crackle |
| static noise | texture | Broadband radio-like static noise. | static, white noise |
| crowd ambience | texture | A crowd murmuring and reacting in the background. | crowd |
| rain ambience | texture | Continuous rain pattering or splashing. | rain |
| wind ambience | texture | Wind blowing and rustling. | wind |
| water ambience | texture | Flowing splashing or rippling water. | water |
| bird ambience | texture | Birds chirping and singing in the background. | birds |
| machine ambience | texture | Continuous mechanical whirring rattling or humming. | mechanical ambience |
| foley hit | texture | A short recorded everyday object contact or movement sound. | found sound |

### Character (33)

| Category | Family | Description | Aliases |
|---|---|---|---|
| airy | timbre | A soft airy and breathy sound. | — |
| distorted | timbre | A harsh distorted buzzing sound. | distortion |
| metallic | timbre | A bright metallic ringing sound. | — |
| warm | timbre | A warm mellow rounded musical tone. | — |
| gritty | timbre | A rough grainy noisy musical texture. | gritty tone |
| smooth | timbre | A smooth even tone without rough or harsh overtones. | — |
| hollow | timbre | A hollow resonant tone with a woody or tubular sound. | — |
| nasal | timbre | A narrow nasal pinched musical tone. | — |
| woody | timbre | A dry woody resonant sound. | — |
| glassy | timbre | A clear glassy ringing musical tone. | — |
| dark | brightness | A dark muffled musical tone. | muffled |
| bright | brightness | A bright sharp musical tone. | — |
| sustained | articulation | Long sustained sounds with a steady tone. | — |
| plucked | articulation | Short plucked musical notes with a sharp attack and decay. | — |
| percussive | articulation | Short struck sounds with sharp transients. | — |
| swelling | articulation | A sound slowly swelling from quiet to loud. | — |
| staccato | articulation | Short clipped separated musical notes. | — |
| rhythmic | rhythm | A rhythmic repeating musical pattern. | — |
| pulsing | rhythm | A musical tone repeatedly pulsing in volume. | — |
| syncopated | rhythm | A musical rhythm with accents between the main beats. | — |
| rolling | rhythm | A continuous rapid rolling rhythm. | — |
| reverberant | space | A sound with a long reverberating tail. | wet, reverb |
| dry | space | A close sound without audible reverberation or echo. | — |
| echoing | space | A sound with distinct repeating delay echoes. | delay, echo |
| rising | motion | A sound rising in pitch over time. | — |
| falling | motion | A sound falling in pitch over time. | — |
| gliding | motion | A musical note smoothly gliding between pitches. | portamento, slide |
| wobbling | motion | A tone with repeated changes in pitch or filter color. | — |
| bitcrushed | processing | A grainy digitally crushed sound with low resolution artifacts. | bit crush, lo-fi digital |
| filtered | processing | A sound with an audible frequency filter sweep. | — |
| chorused | processing | A widened detuned sound with gentle beating tones. | chorus |
| flanged | processing | A sound with moving comb-filter whooshing overtones. | flanger |
| saturated | processing | A thick mildly overdriven musical tone. | overdriven |
