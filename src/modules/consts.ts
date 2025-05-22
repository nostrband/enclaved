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

export const KIND_ENCLAVED_PRODUCT = 63790;
export const KIND_ENCLAVED_RELEASE = 63791;
export const KIND_ENCLAVED_RELEASE_SIGNATURE = 63792;

export const KIND_DOCKER_DIFF = 63800;

// created 29.04.25
export const KIND_ENCLAVED_RPC = 29425;

export const REPO = "https://github.com/nostrband/enclaved";
export const ANNOUNCEMENT_INTERVAL = 3600000; // 1h

export const MIN_PORTS_FROM = 5000;
export const PORTS_PER_CONTAINER = 100;
export const CERT_TTL = 3 * 3600; // 3h

export const CONF_FILE = "enclaved.json";

export const TOTAL_UNITS = 100;
export const SATS_PER_UNIT_PER_INTERVAL = 5;
export const DISK_PER_UNIT_MB = 50;
// FIXME DEBUG
export const CHARGE_INTERVAL = 30; // 1h

export const NWC_RELAY = "wss://relay.zap.land";