---
title: Feedback
description: Ask users to give their feedback about your service at any point of the journey
section: Components
discussionId: 4978
layout: layout-pane.njk
status:
  type: Trial
  links:
    - href: "#research-on-this-component"
      text: Research on this component
    - href: "#help-improve-this-page"
      text: Help improve this component
  date: August 2026
  dataCollectionUrl: https://github.com/alphagov/govuk-design-system/discussions/5619
---

{% from "_example.njk" import example %}

Ask users to give feedback about their experience using your service.

{{ example({ group: "components", item: "feedback", example: "default", html: true, nunjucks: true, loading: "eager" }) }}

## When to use this component

Use the Feedback component to give users the opportunity to give feedback at any point in their journey. This helps you gather a wide range of feedback to understand how well your service performs and improvements you can make.

## How it works

Show the Feedback component on as many pages of your service as you can.

The component is designed to allow users to give feedback at any time without distracting them.

### Ask for feedback at the end of each page

Place the Feedback component just before the GOV.UK footer component.

If your service is using Nunjucks, you can use the [GOV.UK Frontend page template](/styles/page-template/) to add the Fee