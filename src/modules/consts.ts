export const KIND_PROFILE = 0;
export const KIND_NOTE = 1;

export const KIND_RELAYS = 10002;
export const KIND_NIP46 = 24133;

// instance event plus certificate from the enclave
export const KIND_INSTANCE = 63793;
export const KIND_BUILD = 63794;

// build and instance signatures (should we rename to "certificates")?
export const KIND_BUILD_SIGNATURE = 63795;
export const KIND_INSTANCE_SIGNATURE = 63796;

// enclaved container + certificate
export const KIND_ENCLAVED_PROCESS = 63797;

export const KIND_ROOT_CERTIFICATE = 23793;
export const KIND_ENCLAVED_CERTIFICATE = 23797;

// export const KIND_ENCLAVED_PRODUCT = 63790;
// export const KIND_ENCLAVED_RELEASE = 63791;

export const KIND_RELEASE_SIGNATURE = 63792;

export const KIND_DOCKER_DIFF = 63800;

// created 29.04.25
export const KIND_ENCLAVED_RPC = 29425;
export const KIND_KEYCRUX_RPC = 29525;

export const REPO = "https://github.com/nostrband/enclaved";
export const ANNOUNCEMENT_INTERVAL = 3600000; // 1h

export const MIN_PORTS_FROM = 5000;
export const PORTS_PER_CONTAINER = 100;
export const CERT_TTL = 3 * 3600; // 3h

export const CONF_FILE = "enclaved.json";

export const TOTAL_UNITS = 100;
export const SATS_PER_UNIT_PER_INTERVAL = 5;
export const DISK_PER_UNIT_MB = 50;
export const VOLUME_PER_UNIT_MB = 10;
export const CHARGE_INTERVAL = 3600; // 1h

export const NWC_RELAY = "wss://relay.zap.land";
export const ENCLAVED_RELAY = "wss://relay.enclaved.org";
export const SEARCH_RELAY = "wss://relay.nostr.band/all";

export const KEYCRUX_REPO = "https://github.com/nostrband/keycrux";
export const KEYCRUX_PCR0 = "dd584a92acb37d5c9d0ef37c6defbccacc3a3aa045a9b21db5a74f22c68c84b0f1bcf4418cb61c44f043dbdfd7f71548";
export const KEYCRUX_PCR1 = "4b4d5b3661b3efc12920900c80e126e4ce783c522de6c02a2a5bf7af3a2b9327b86776f188e4be1c1c404a129dbda493";
export const KEYCRUX_PCR2 = "2f571067a8bf0adc712f4c4cccb80aee03a009d21c343203c529f466758d75febfe90e4d4a72d881b57bb23023e6f176";