export function getPartName() {
  if (!process.env.PART_NAME) {
    throw new Error("PART_NAME is not set");
  }
  return process.env.PART_NAME;
}
