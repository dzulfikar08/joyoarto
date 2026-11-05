// Taking or picking a receipt photo (expo-image-picker) and shrinking it (expo-image-manipulator) before upload.
// Device glue; the sizes are in src/lib/receipt.ts. The camera permission is asked the first time "Foto" is tapped;
// the gallery uses the system photo picker (no permission on Android 13+).

import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { RECEIPT_QUALITY, resizeFor } from "./receipt";

export type ReceiptPhoto = { uri: string; width: number; height: number };

export class CameraDenied extends Error {
  constructor(readonly canAskAgain: boolean) {
    super("JoyoArto can't use the camera. Allow it in Settings, or pick a photo from the gallery.");
    this.name = "CameraDenied";
  }
}

/** A JPEG of the receipt in the cache directory, or null when the member cancelled. */
export async function pickReceiptPhoto(source: "camera" | "library"): Promise<ReceiptPhoto | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, exif: false, allowsEditing: false };
  let result: ImagePicker.ImagePickerResult;
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new CameraDenied(perm.canAskAgain);
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const ctx = ImageManipulator.manipulate(asset.uri);
  const size = resizeFor(asset.width, asset.height);
  if (size) ctx.resize(size);
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: RECEIPT_QUALITY, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}
