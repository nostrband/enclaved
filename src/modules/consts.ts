export const KIND_PROFILE = 0;
export const KIND_NOTE = 1;

export const KIND_RELAYS = 10002;
export const KIND_NIP46 = 24133;

// service announcement with attestation
export const KIND_ANNOUNCEMENT = 13793;

// enclaved container + certificate
export const KIND_ENCLAVED_PROCESS = 63797;

export const KIND_ROOT_CERTIFICATE = 23793;
export const KIND_BUILD_SIGNATURE = 23794;
export const KIND_INSTANCE_SIGNATURE = 23795;
export const KIND_ENCLAVED_CERTIFICATE = 23797;

export const KIND_RELEASE_SIGNATURE = 63794;


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
// brugeman only for now
export const KEYCRUX_RELEASE_SIGNERS = ["3356de61b39647931ce8b2140b2bab837e0810c0ef515bbe92de0248040b8bdd"];
