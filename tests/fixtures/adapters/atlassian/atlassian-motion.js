/**
 * THIS FILE WAS CREATED VIA CODEGEN DO NOT MODIFY {@see http://go/af-codegen}
 * @codegen <<SignedSource::trimmed-fixture>>
 * @codegenCommand yarn build tokens
 */

const tokens = [
  {
    "attributes": {
      "group": "motion",
      "state": "active",
      "introduced": "11.2.0",
      "description": "Use for avatar group enter transitions."
    },
    "value": {
      "duration": 150,
      "curve": "cubic-bezier(0.4, 1, 0.6, 1)",
      "keyframes": [
        "ScaleIn80to100",
        "FadeIn0to100"
      ],
      "fill": "backwards"
    },
    "filePath": "schema/themes/atlassian-motion/motion.tsx",
    "isSource": true,
    "original": {
      "attributes": {
        "group": "motion",
        "state": "active",
        "introduced": "11.2.0",
        "description": "Use for avatar group enter transitions."
      },
      "value": {
        "duration": "Duration150",
        "curve": "EasePracticalOut",
        "keyframes": [
          "ScaleIn80to100",
          "FadeIn0to100"
        ],
        "fill": "AnimationFillModeBackwards"
      }
    },
    "name": "motion.avatar.enter",
    "path": [
      "motion",
      "avatar",
      "enter"
    ],
    "cleanName": "motion.avatar.enter"
  }
];
export default tokens;
