import { File, Paths } from "expo-file-system";

/** A JSON document in the app's private documents directory. Never synced or backed up off the device by us. */
export function jsonFile<T>(name: string) {
  const file = new File(Paths.document, name);
  return {
    async read(): Promise<T | null> {
      try {
        if (!file.exists) return null;
        return JSON.parse(await file.text()) as T;
      } catch {
        return null;
      }
    },
    write(value: T) {
      if (!file.exists) file.create({ intermediates: true });
      file.write(JSON.stringify(value));
    },
  };
}
