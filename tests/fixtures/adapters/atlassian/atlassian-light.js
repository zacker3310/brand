/**
 * THIS FILE WAS CREATED VIA CODEGEN DO NOT MODIFY {@see http://go/af-codegen}
 * @codegen <<SignedSource::trimmed-fixture>>
 * @codegenCommand yarn build tokens
 */

const tokens = [
  {
    "attributes": {
      "group": "paint",
      "state": "active",
      "introduced": "0.7.0",
      "description": "Use for blue backgrounds when there is no meaning tied to the color, and the background needs to pass min 3:1 contrast requirements."
    },
    "value": "#1868DB",
    "filePath": "schema/themes/atlassian-light/color/accent.tsx",
    "isSource": true,
    "original": {
      "attributes": {
        "group": "paint",
        "state": "active",
        "introduced": "0.7.0",
        "description": "Use for blue backgrounds when there is no meaning tied to the color, and the background needs to pass min 3:1 contrast requirements."
      },
      "value": "Blue700"
    },
    "name": "color.background.accent.blue.bolder.[default]",
    "path": [
      "color",
      "background",
      "accent",
      "blue",
      "bolder",
      "[default]"
    ],
    "cleanName": "color.background.accent.blue.bolder"
  },
  {
    "attributes": {
      "group": "shadow",
      "state": "active",
      "introduced": "0.6.0",
      "description": "Use for the box shadow of raised card elements, such as Jira cards on a Kanban board. Combine with elevation.surface.raised"
    },
    "value": [
      {
        "radius": 1,
        "offset": {
          "x": 0,
          "y": 1
        },
        "color": "#1E1F21",
        "opacity": 0.25
      },
      {
        "radius": 1,
        "offset": {
          "x": 0,
          "y": 0
        },
        "color": "#1E1F21",
        "opacity": 0.31
      }
    ],
    "filePath": "schema/themes/atlassian-light/elevation/shadow.tsx",
    "isSource": true,
    "original": {
      "attributes": {
        "group": "shadow",
        "state": "active",
        "introduced": "0.6.0",
        "description": "Use for the box shadow of raised card elements, such as Jira cards on a Kanban board. Combine with elevation.surface.raised"
      },
      "value": [
        {
          "radius": 1,
          "offset": {
            "x": 0,
            "y": 1
          },
          "color": "Neutral1100",
          "opacity": 0.25
        },
        {
          "radius": 1,
          "offset": {
            "x": 0,
            "y": 0
          },
          "color": "Neutral1100",
          "opacity": 0.31
        }
      ]
    },
    "name": "elevation.shadow.raised",
    "path": [
      "elevation",
      "shadow",
      "raised"
    ],
    "cleanName": "elevation.shadow.raised"
  },
  {
    "attributes": {
      "group": "opacity",
      "state": "active",
      "introduced": "0.10.13",
      "description": "Apply to images when in a disabled state."
    },
    "value": 0.4,
    "filePath": "schema/themes/atlassian-light/opacity/opacity.tsx",
    "isSource": true,
    "original": {
      "attributes": {
        "group": "opacity",
        "state": "active",
        "introduced": "0.10.13",
        "description": "Apply to images when in a disabled state."
      },
      "value": "Opacity40"
    },
    "name": "opacity.disabled",
    "path": [
      "opacity",
      "disabled"
    ],
    "cleanName": "opacity.disabled"
  },
  {
    "attributes": {
      "group": "raw",
      "state": "active",
      "introduced": "0.1.1",
      "description": "Transparent token used for backwards compatibility between new and old theming solutions"
    },
    "value": "transparent",
    "filePath": "schema/themes/atlassian-light/utility/utility.tsx",
    "isSource": true,
    "original": {
      "attributes": {
        "group": "raw",
        "state": "active",
        "introduced": "0.1.1",
        "description": "Transparent token used for backwards compatibility between new and old theming solutions"
      },
      "value": "transparent"
    },
    "name": "utility.UNSAFE.transparent",
    "path": [
      "utility",
      "UNSAFE",
      "transparent"
    ],
    "cleanName": "utility.UNSAFE.transparent"
  }
];
export default tokens;
