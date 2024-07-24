export class LineLogger {
  buffer = "";
  add(text: string, addition: string) {
    this.buffer += text;
    const toPrint: string[] = [];
    while (true) {
      const index = this.buffer.indexOf("\n");
      if (index === -1) {
        break;
      }
      toPrint.push(this.buffer.slice(0, index));
      this.buffer = this.buffer.slice(index + 1);
    }
    if (addition && toPrint.length) {
      toPrint[toPrint.length - 1] += " — " + addition;
    }
    for (const line of toPrint) {
      console.log(line);
    }
  }
  finish() {
    if (this.buffer) {
      console.log(this.buffer);
    }
  }
}
