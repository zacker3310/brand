---
title: Component lifecycle statuses
description: The component lifecycle outlines how components develop over time within the GOV.UK Design System
section: Community
theme: How we work
layout: layout-pane.njk
order: 9
---

{% from "_example.njk" import example %}

The component lifecycle outlines how components develop over time within the GOV.UK Design System. We also use it to communicate our level of confidence that a component is suitable for use in a wide range of public-facing services.

The GOV.UK Design System:

- trials new components
- iterates existing components
- deprecates components that do not adapt to evolving user needs, current research and technologies

We currently use 2 component statuses on the GOV.UK Design System website:

- Trial - these components have a trial status tag
- Stable - these components do not have a tag

## Trial components

The guidance page for each trial component has a trial status tag and message:

{{ example({ group: "community", item: "component-lifecycle-statuses", example: "default", loading: "eager" }) }}

We use trial status when we release components (or variants of components) that might not meet all our [contribution criteria](/community/contribution-criteria/). We do this for components or variants that:

- are new or have significantly changed
- are potentially valuable but need further testing in services
- we're actively working on

We release trial components or variants to:

- get feedback from the community
- al