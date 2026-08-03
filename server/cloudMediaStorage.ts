export async function publishCloudObject(input: {
  commit: () => Promise<void> | void;
  remove: () => Promise<void>;
  upload: () => Promise<void>;
}) {
  let uploaded = false;
  try {
    await input.upload();
    uploaded = true;
    await input.commit();
  } catch (error) {
    if (uploaded) {
      try {
        await input.remove();
      } catch {
        throw new Error("Cloud media rollback failed", { cause: error });
      }
    }
    throw error;
  }
}
