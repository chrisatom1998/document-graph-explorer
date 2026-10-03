// Frozen provisional CALIB routing; never an acceptance or validation receipt.
import type {FusionIdentity,FusionLabel} from '../fusion';
export const PASST_IDENTITY: FusionIdentity = {
  "modelSha256": "4558e8289ecf33d13b1df93331090c93c1623802889a14fec20b11af6253d211",
  "policySha256": "44c83691e955866973c693aa1917dca204135fe0d6f4f4aeda5b981ecb11c55d",
  "scorerSha256": "1959de5e811921590f9811f3520927bd9cc4718d9f77f5be4aef8115f5a4b4c7"
};
export const PASST_POLICY: Record<FusionLabel,{enabled:boolean;threshold:number|null}> = {
  "accordion": {
    "enabled": false,
    "threshold": null
  },
  "banjo": {
    "enabled": false,
    "threshold": null
  },
  "bass": {
    "enabled": true,
    "threshold": 0.11034611240029335
  },
  "cello": {
    "enabled": false,
    "threshold": null
  },
  "clarinet": {
    "enabled": true,
    "threshold": 0.11155643314123154
  },
  "cymbals": {
    "enabled": false,
    "threshold": null
  },
  "drums": {
    "enabled": false,
    "threshold": null
  },
  "flute": {
    "enabled": false,
    "threshold": null
  },
  "guitar": {
    "enabled": false,
    "threshold": null
  },
  "mallet_percussion": {
    "enabled": false,
    "threshold": null
  },
  "mandolin": {
    "enabled": false,
    "threshold": null
  },
  "organ": {
    "enabled": true,
    "threshold": 0.2771495506167412
  },
  "piano": {
    "enabled": true,
    "threshold": 0.5474719554185867
  },
  "saxophone": {
    "enabled": false,
    "threshold": null
  },
  "synthesizer": {
    "enabled": false,
    "threshold": null
  },
  "trombone": {
    "enabled": false,
    "threshold": null
  },
  "trumpet": {
    "enabled": false,
    "threshold": null
  },
  "ukulele": {
    "enabled": false,
    "threshold": null
  },
  "violin": {
    "enabled": false,
    "threshold": null
  },
  "voice": {
    "enabled": false,
    "threshold": null
  }
};
