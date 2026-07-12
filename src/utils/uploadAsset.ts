import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

const IMAGE_WIDTH_LIMIT = 1800;
const IMPORT_MAX_DIMENSION = 1600;
const IMPORT_COMPRESS_QUALITY = 0.88;
const documentDirectory = FileSystem.documentDirectory ?? undefined;
const uploadDirectory = documentDirectory ? `${documentDirectory}uploads/` : undefined;

export const prepareDocumentUpload = async ({
  uri,
  fileName,
  lowResolution,
  source,
}: {
  uri: string;
  fileName: string;
  lowResolution: boolean;
  source?: 'camera' | 'gallery' | 'files' | 'seeded';
}) => {
  const normalizedUploadName = isImageFile(fileName, uri) ? normalizeJpegName(fileName) : fileName;

  if (!isImageFile(fileName, uri)) {
    const stableUri = await persistPreparedUpload(uri, normalizedUploadName);
    return {
      uri: stableUri,
      fileName: normalizedUploadName,
      mimeType: inferMimeType(fileName),
    };
  }

  if (source === 'camera') {
    const stableUri = await persistPreparedUpload(uri, normalizedUploadName);
    return {
      uri: stableUri,
      fileName: normalizedUploadName,
      mimeType: 'image/jpeg',
    };
  }

  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: IMAGE_WIDTH_LIMIT, height: null });
    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({
      compress: lowResolution ? 0.55 : 0.85,
      format: SaveFormat.JPEG,
    });

    return {
      uri: await persistPreparedUpload(result.uri, normalizedUploadName),
      fileName: normalizedUploadName,
      mimeType: 'image/jpeg',
    };
  } catch {
    const stableUri = await persistPreparedUpload(uri, normalizedUploadName);
    return {
      uri: stableUri,
      fileName: inferMimeType(fileName) === 'image/jpeg' ? normalizedUploadName : fileName,
      mimeType: inferMimeType(fileName),
    };
  }
};

export const readFileSize = async (uri: string) => {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? info.size ?? null : null;
};

export const prepareImportedImageForApp = async ({
  id,
  uri,
  fileName,
}: {
  id: string;
  uri: string;
  fileName: string;
}) => {
  const normalizedFileName = normalizeJpegName(fileName);

  try {
    const size = await getImageSize(uri);
    const resized = getResizeTarget(size.width, size.height, IMPORT_MAX_DIMENSION);
    const context = ImageManipulator.manipulate(uri);
    context.resize(resized);
    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({
      compress: IMPORT_COMPRESS_QUALITY,
      format: SaveFormat.JPEG,
    });

    return {
      uri: await persistImportedImage(id, result.uri, normalizedFileName),
      fileName: normalizedFileName,
      mimeType: 'image/jpeg' as const,
    };
  } catch {
    return {
      uri,
      fileName: normalizedFileName,
      mimeType: 'image/jpeg' as const,
    };
  }
};

function isImageFile(fileName: string, uri: string) {
  return /\.(jpg|jpeg|png|webp|heic)$/i.test(fileName) || /^file:.*\.(jpg|jpeg|png|webp|heic)$/i.test(uri);
}

function normalizeJpegName(fileName: string) {
  const stem = fileName.replace(/\.[^/.]+$/, '') || `capture-${Date.now()}`;
  return `${stem}.jpg`;
}

function getImageSize(uri: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error),
    );
  });
}

function getResizeTarget(width: number, height: number, maxDimension: number) {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }

  if (width >= height) {
    const ratio = maxDimension / width;
    return {
      width: maxDimension,
      height: Math.max(1, Math.round(height * ratio)),
    };
  }

  const ratio = maxDimension / height;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: maxDimension,
  };
}

async function persistImportedImage(id: string, uri: string, fileName: string) {
  if (!documentDirectory) {
    return uri;
  }

  const importDirectory = `${documentDirectory}imports/`;
  const nextUri = `${importDirectory}${id}-${fileName}`;

  try {
    await FileSystem.makeDirectoryAsync(importDirectory, { intermediates: true });
    await FileSystem.copyAsync({
      from: uri,
      to: nextUri,
    });
    return nextUri;
  } catch {
    return uri;
  }
}

async function persistPreparedUpload(uri: string, fileName: string) {
  if (!uploadDirectory) {
    return uri;
  }

  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || `upload-${Date.now()}.jpg`;
  const nextUri = `${uploadDirectory}${safeFileName}`;

  try {
    await FileSystem.makeDirectoryAsync(uploadDirectory, { intermediates: true });
    await FileSystem.copyAsync({
      from: uri,
      to: nextUri,
    });
    return nextUri;
  } catch {
    return uri;
  }
}

function inferMimeType(fileName: string) {
  if (/\.pdf$/i.test(fileName)) {
    return 'application/pdf';
  }
  if (/\.png$/i.test(fileName)) {
    return 'image/png';
  }
  if (/\.webp$/i.test(fileName)) {
    return 'image/webp';
  }
  return 'image/jpeg';
}
