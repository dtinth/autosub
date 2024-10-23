export function bufferedLog(log: (message: string) => void) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let buffer = "";
  return (message: string) => {
    buffer += message;
    if (!timeout) {
      timeout = setTimeout(() => {
        log(buffer);
        buffer = "";
        timeout = undefined;
      }, 1000);
    }
  };
}
