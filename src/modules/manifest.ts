// NOTE: written by RooCode based on skopeo codebase

/**
 * Interface for Docker manifest response
 */
interface DockerManifest {
  schemaVersion: number;
  mediaType: string;
  config: {
    mediaType: string;
    size: number;
    digest: string;
  };
  layers: Array<{
    mediaType: string;
    size: number;
    digest: string;
  }>;
  // Additional fields may be present depending on the manifest version
}

interface DockerDistributionManifest {
  digest: string;
  platform: {
    architecture: string;
    os: string;
  };
}

interface DockerDistributionManifestList {
  manifests: DockerDistributionManifest[];
}

// /**
//  * Interface for Docker image configuration
//  */
// interface DockerConfig {
//   architecture: string;
//   os: string;
//   created: string;
//   config: {
//     Hostname: string;
//     Domainname: string;
//     User: string;
//     ExposedPorts?: Record<string, {}>;
//     Env: string[];
//     Cmd: string[];
//     Volumes?: Record<string, {}>; // This is where volume information is stored
//     WorkingDir: string;
//     Entrypoint?: string[];
//     Labels?: Record<string, string>;
//   };
//   rootfs: {
//     type: string;
//     diff_ids: string[];
//   };
//   history: Array<{
//     created: string;
//     created_by: string;
//     empty_layer?: boolean;
//   }>;
// }

/**
 * Interface for Docker Hub authentication token response
 */
interface AuthTokenResponse {
  token: string;
  expires_in: number;
  issued_at: string;
}

/**
 * Interface for parsed Docker image reference
 */
interface ParsedImageReference {
  repository: string;
  reference: string;
  isDigest: boolean;
}

function getDigest(
  list: DockerDistributionManifestList,
  architecture: string = "x86_64",
  os: string = "linux"
) {
  const m = list.manifests.find(
    (m) => m.platform.architecture === architecture && m.platform.os === os
  );
  return m?.digest;
}


/**
 * Parses a Docker image reference into its components
 * 
 * @param imageRef - Docker image reference (e.g., "busybox:latest" or "nostrband/nwc-enclaved@sha256:2ed53...")
 * @returns Parsed image reference components
 */
function parseImageReference(imageRef: string): ParsedImageReference {
  // Check if the reference contains a digest (indicated by '@')
  const digestSeparatorIndex = imageRef.lastIndexOf('@');
  const tagSeparatorIndex = imageRef.lastIndexOf(':');
  
  let repository: string;
  let reference: string;
  let isDigest = false;
  
  if (digestSeparatorIndex !== -1) {
    // This is a digest-based reference
    repository = imageRef.substring(0, digestSeparatorIndex);
    reference = imageRef.substring(digestSeparatorIndex + 1);
    isDigest = true;
  } else if (tagSeparatorIndex !== -1 && !imageRef.substring(0, tagSeparatorIndex).includes('/')) {
    // This is a tag-based reference for an official image
    repository = imageRef.substring(0, tagSeparatorIndex);
    reference = imageRef.substring(tagSeparatorIndex + 1);
  } else if (tagSeparatorIndex !== -1 && tagSeparatorIndex > imageRef.lastIndexOf('/')) {
    // This is a tag-based reference for a user repository
    repository = imageRef.substring(0, tagSeparatorIndex);
    reference = imageRef.substring(tagSeparatorIndex + 1);
  } else {
    // This is a reference without a tag, use "latest"
    repository = imageRef;
    reference = "latest";
  }
  
  // Handle official images (like "busybox") which are actually in the "library" namespace
  if (!repository.includes('/')) {
    repository = `library/${repository}`;
  }
  
  return { repository, reference, isDigest };
}

/**
 * Fetches a Docker image manifest and configuration from Docker Hub
 *
 * @param imageRef - Docker image ref (e.g., "busybox" or "nostrband/nwc-enclaved:latest" or "busybox@sha256:...")
 * @returns Promise resolving to the image information including volumes
 */
export async function fetchDockerImageInfo({
  imageRef,
  architecture = "amd64",
  os = "linux",
}: {
  imageRef: string;
  architecture?: string;
  os?: string;
}): Promise<DockerManifest> {
  const { repository, reference, isDigest } = parseImageReference(imageRef);

  // Step 1: Get authentication token
  const token = await getAuthToken(repository);

  // Step 2: Fetch the manifest
  const manifest = await fetchManifestWithToken(repository, reference, isDigest, token);
  console.log("manifest", manifest);

  // if not list - return
  if (
    manifest.mediaType ===
      "application/vnd.docker.distribution.manifest.v2+json" ||
    manifest.mediaType === "application/vnd.oci.image.manifest.v1+json"
  ) {
    const config = await fetchConfigBlob(repository, manifest.config.digest, token);
    console.log("config", config);
    return manifest;
  }

  // find manifest hash for our platform
  const list = manifest as unknown as DockerDistributionManifestList;
  const digest = getDigest(list, architecture, os);
  console.log("digest", digest);
  if (!digest) throw new Error("Failed to get digest");

  // Step 3: Fetch the platform-specific manifest
  return await fetchConfigBlob(repository, digest, token);
}

/**
 * Gets an authentication token for Docker Hub
 *
 * @param repository - Docker repository name
 * @returns Promise resolving to the authentication token
 */
async function getAuthToken(repository: string): Promise<string> {
  try {
    // The scope follows the format used in skopeo: "repository:{repository}:pull"
    const authUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`;

    const response = await fetch(authUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to get auth token: ${response.status} ${response.statusText}`
      );
    }

    const data: AuthTokenResponse = await response.json();
    return data.token;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to get auth token: ${error.message}`);
    }
    throw new Error(`Failed to get auth token: ${String(error)}`);
  }
}

/**
 * Fetches a manifest using the provided authentication token
 * 
 * @param repository - Docker repository name
 * @param reference - Image tag or digest
 * @param isDigest - Whether the reference is a digest
 * @param token - Authentication token
 * @returns Promise resolving to the parsed manifest
 */
async function fetchManifestWithToken(
  repository: string, 
  reference: string,
  isDigest: boolean,
  token: string
): Promise<DockerManifest> {
  try {
    // Following the manifest path format from skopeo: /v2/{repository}/manifests/{tag or digest}
    const manifestUrl = `https://registry-1.docker.io/v2/${repository}/manifests/${reference}`;
    
    // Set the appropriate Accept headers to request the manifest in supported MIME types
    // These are the same types used in skopeo's DefaultRequestedManifestMIMETypes
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Accept': [
        'application/vnd.docker.distribution.manifest.v2+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.oci.image.index.v1+json'
      ].join(',')
    };
    
    // If we're fetching by digest, we need to add the digest header
    if (isDigest && reference.startsWith('sha256:')) {
      headers['Accept'] += ',application/vnd.docker.distribution.manifest.v1+prettyjws';
    }
    
    const response = await fetch(manifestUrl, { headers });
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Manifest not found for ${repository} with reference ${reference}`);
      }
      
      const errorText = await response.text();
      throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}, Details: ${errorText}`);
    }
    
    const data: DockerManifest = await response.json();
    return data;
  } catch (error) {
    if (error instanceof Error) {
      throw error; // Re-throw if it's already a well-formatted error
    }
    throw new Error(`Failed to fetch manifest: ${String(error)}`);
  }
}

/**
 * Fetches a config blob using the provided authentication token
 *
 * @param repository - Docker repository name
 * @param digest - Config blob digest
 * @param token - Authentication token
 * @returns Promise resolving to the parsed config
 */
async function fetchConfigBlob(
  repository: string,
  digest: string,
  token: string
): Promise<DockerManifest> {
  try {
    // Following the blob path format from skopeo: /v2/{repository}/blobs/{digest}
    const blobUrl = `https://registry-1.docker.io/v2/${repository}/blobs/${digest}`;

    const response = await fetch(blobUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Config blob not found for ${repository} with digest ${digest}`
        );
      }

      const errorText = await response.text();
      throw new Error(
        `Failed to fetch config blob: ${response.status} ${response.statusText}, Details: ${errorText}`
      );
    }

    const data: DockerManifest = await response.json();
    return data;
  } catch (error) {
    if (error instanceof Error) {
      throw error; // Re-throw if it's already a well-formatted error
    }
    throw new Error(`Failed to fetch config blob: ${String(error)}`);
  }
}
