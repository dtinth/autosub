import { WordTimestamp, WordTimestamps } from "./WordTimestamps";

export interface Partition {
  name: string;
  start: number;
  end: number;
}

export interface Partitions {
  partitions: Partition[];
}

type Tree =
  | { words: WordTimestamp[] }
  | { words?: undefined; left: Tree; right: Tree; gap: number };

function duration(words: WordTimestamp[]) {
  const first = words[0].start;
  const last = words[words.length - 1].end;
  return last - first;
}

function split(words: WordTimestamp[], options: { short: boolean }): Tree {
  const maxLength = options.short ? 60 : 3 * 60;
  const minLength = options.short ? 15 : 30;
  const thisDuration = duration(words);
  if (thisDuration < maxLength) {
    return { words };
  }
  let bestCandidate:
    | {
        score: number;
        left: WordTimestamp[];
        right: WordTimestamp[];
        gap: number;
      }
    | undefined;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i);
    const right = words.slice(i);
    const leftDuration = duration(left);
    const rightDuration = duration(right);
    if (leftDuration < minLength || rightDuration < minLength) {
      continue;
    }
    const evenness =
      Math.min(leftDuration, rightDuration) /
      Math.max(leftDuration, rightDuration);
    const gap = thisDuration - leftDuration - rightDuration;
    const score = evenness * gap;
    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { score, left, right, gap };
    }
  }
  if (!bestCandidate) {
    throw new Error("No best candidate found");
  }
  return {
    left: split(bestCandidate.left, options),
    right: split(bestCandidate.right, options),
    gap: bestCandidate.gap,
  };
}

function generateParts(root: Tree): Partition[] {
  const parts: Partition[] = [];
  const traverse = (tree: Tree, gap = 0) => {
    if (tree.words) {
      parts.push({
        name: `part_` + (parts.length + 1).toString().padStart(2, "0"),
        start: tree.words[0].start,
        end: tree.words[tree.words.length - 1].end + gap * 0.75,
      });
    } else {
      traverse(tree.left, tree.gap);
      traverse(tree.right, gap);
    }
  };
  traverse(root);
  for (let i = 0; i < parts.length - 1; i++) {
    parts[i].start = i > 0 ? parts[i - 1].end : 0;
  }
  return parts;
}

function* visualizeTree(tree: Tree, gap = 0, path = "") {
  if (tree.words) {
    yield visualize(tree.words, gap, path);
  } else {
    yield* visualizeTree(tree.left, tree.gap, path + "0");
    yield* visualizeTree(tree.right, gap, path + "1");
  }
}
function visualize(words: WordTimestamp[], gap = 0, path = "") {
  return `${path} | ${duration(words).toFixed(1)}s ${
    words.length
  } words + ${gap.toFixed(1)}s gap`;
}

export function partition(
  wordTimestamps: WordTimestamps,
  options: {
    short: boolean;
    log: (message: string) => void;
  }
): Partitions {
  const { log, short } = options;
  const root: Tree = split(wordTimestamps.words, { short });
  for (const message of visualizeTree(root)) {
    log(message);
  }
  const partitions = generateParts(root);
  return { partitions };
}
