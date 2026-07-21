/**
 * Shared device notes and copy helpers for ATT Buyers' Club structured paths.
 */

export const DEVICE_NETWORK_RESET: Record<
  "iphone" | "samsung" | "pixel" | "data-only",
  string[]
> = {
  iphone: [
    "Settings → General → Transfer or Reset iPhone → Reset → Reset Network Settings",
    "If physical SIM: remove the SIM, wait 30 seconds, reinsert, then retest",
    "If eSIM: skip SIM pull — network reset only",
  ],
  samsung: [
    "Settings → General management → Reset → Reset network settings",
    "If physical SIM: remove the SIM, wait 30 seconds, reinsert, then retest",
    "If eSIM: skip SIM pull — network reset only",
  ],
  pixel: [
    "Settings → System → Reset options → Reset Wi‑Fi, mobile & Bluetooth",
    "If physical SIM: remove the SIM, wait 30 seconds, reinsert, then retest",
    "If eSIM: skip SIM pull — network reset only",
  ],
  "data-only": [
    "Power cycle the device completely",
    "Toggle airplane mode for 30 seconds, then turn it off",
    "Reset network/APN to default if the device UI allows",
    "If physical SIM: reseat the SIM and retest",
  ],
};

export const ATT_TIER1 =
  "Call AT&T tier-1 support: 1-888-334-3787 · Security PIN 10426";

export const OPUS_URL = "https://opus.att.net/cc";

export const OPUS_SOURCE =
  "https://appdirect.jira.com/wiki/spaces/vComNoc/pages/6315114528";

/** Confluence how-to: log into OPUS and verify IMEI / ICCID */
export const OPUS_IMEI_ICCID_HELP = {
  label: "Steps to check IMEI & ICCID on Opus",
  url: "https://appdirect.jira.com/wiki/spaces/vComNoc/pages/6196723762/Logging+into+OPUS+and+verifying+IMEI+and+ICCID+SIM+NUMBER",
} as const;

/** Confluence: APEX rate plan / SOC codes for AT&T plan verification */
export const ATT_PLANS_HELP = {
  label: "Verify AT&T Plans",
  url: "https://appdirect.jira.com/wiki/spaces/vComNoc/pages/6198427669/APEX+Rate+Plan+Codes+SOC+codes",
} as const;

/** Confluence how-to: provision a new eSIM in ATT OPUS */
export const OPUS_NEW_ESIM_HELP = {
  label: "How to provision new eSIM",
  url: "https://appdirect.jira.com/wiki/spaces/vComNoc/pages/6199017508/Provision+a+new+eSIM+ATT+OPUS",
} as const;

export const SIGN_OFF = `Thank you,
vCom NOC Support`;
