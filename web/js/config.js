// The one place the video format lives. 16:9; change both numbers together.
export const STAGE = Object.freeze({ width: 1920, height: 1080 });

// How much of the stage height a character's canvas takes up when it is
// dropped in at scale 1. Characters stand with their feet near the bottom.
export const DEFAULT_CHARACTER_HEIGHT = 0.9;

export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;
