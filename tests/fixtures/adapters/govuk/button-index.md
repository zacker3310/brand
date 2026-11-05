---
title: Button
description: Use the button component to help users carry out an action
section: Components
aliases:
discussionId: 6094
layout: layout-pane.njk
---

{% from "_example.njk" import example %}

{{ example({ group: "components", item: "button", example: "default", html: true, nunjucks: true, open: false, loading: "eager" }) }}

## When to use this component

Use the button component to help users carry out an action like starting an application or saving their information.

## How it works

Write button text in sentence case, describing the action it performs. For example:

- ‘Start now’ at the [start of your service](/patterns/start-using-a-service/)
- ‘Sign in’ to an account a user has already created
- ‘Continue’ when the service does not save a user’s information
- ‘Save and continue’ when the service does save a user’s information
- ‘Save and come back later’ when a user can save their information and come back later
- ‘Add another’ to add another item to a list or group
- ‘Pay’ to make a payment
- ‘Confirm and send’ on a [Check answers page](/patterns/check-answers/) that does not have any legal content a user must agree to
- ‘Accept and send’ on a [Check answers page](/patterns/check-answers/) that has legal content a user must agree to
- ‘Sign out’ when a user is signed in to an account

You may need to include more or different words to better describe the action. For example, ‘Add another address’ and ‘Accept and claim a tax refund’.

Align the primary action button to the left edge of your form.

There are 2 ways to use the Button component. You can use HTML or, if you are using [Nunjucks](https://mozilla.github.io/nunjucks/) or the [GOV.UK Prototype Kit](https://prototype-kit.service.gov.uk), you can use the Nunjucks macro.

### Default buttons

Use a default button for the main call to action on a page.

Avoid using multiple default buttons on a single page. Having more than one main call to action reduces their impact, and makes it harder for users to know what to do next.

{{ example({ group: "components", item: "button", example: "default", html: true, nunjucks: true, open: false, titleSuffix: "second" }) }}

### Start buttons

Use a start button for the main call to action on [your service’s Start page](/patterns/start-using-a-service/).
Start buttons do not usually submit form data, so use a link tag instead of a button tag.

{{ example({ group: "components", item: "button", example: "start", html: true, nunjucks: true, open: false }) }}

### Secondary buttons

Use secondary buttons for secondary calls to action on a page.

Pages with too many calls to action make it hard for users to know what to do next. Before adding lots of secondary buttons, try to simplify the page or break the content down across multiple pages.

{{ example({ group: "components", item: "button", example: "secondary", html: true, nunjucks: true, open: false }) }}

You can also [group default and secondary buttons together](#grouping-buttons).

### Warning buttons

Warning buttons are designed to make users think carefully before they use them. They only work if used very sparingly. Most services should not need one.

{{ example({ group: "components", item: "button", example: "warning", html: true, nunjucks: true, open: false }) }}

Only use warning buttons for actions with serious destructive consequences that cannot be easily undone by a user. For example, permanently deleting an account.

When letting users carry out an action like this, it's a good idea to include an additional step which asks them to confirm it.

In this instance, use another style of button for the initial call to action, and a warning button for the final confirmation.

Do not only rely on the red colour of a warning button to communicate the serious nature of the action. This is because not all users will be able to see the colour or will understand what it signifies. Make sure the context and button text make clear what will happen if the user selects it.

### Buttons on dark backgrounds

Use the `govuk-button--inverse` modifier class to show white buttons on dark backgrounds – for example, in headers, custom components, and patterns with darker backgrounds.

Make sure all users can see the button – the white button and background colour must have a contrast ratio of at least 4.5:1 to meet [WCAG 2.2 success criterion 1.4.3 Contrast (minimum), level AA](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

{{ example({ group: "components", item: "button", example: "inverse", html: true, nunjucks: true, open: false }) }}

## Research on this component

Testing on GOV.UK has shown that [using green as the colour of start buttons improved click-through rates](https://github.com/alphagov/govuk-design-system/discussions/6094#discussioncomment-18812390).
