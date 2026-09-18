# GitHub Desktop KNWR

A fork of [GitHub Desktop](https://desktop.github.com/) for people who work
across many repositories, more than one hosting provider, and their own AI
tooling. Everything the official app does, plus:

- **Folders and favorites** in the sidebar, nested as deep as you like, and
  adding several local repositories at once.
- **Pull several repositories at once** from a dialog with a filter, select-all
  and a per-repository result — no error dialog per repository.
- **Azure DevOps**: connect organizations with a personal access token, browse
  their repositories grouped by team project, clone one or tick many at once
  (existing folders are flagged before you clone), and authenticate every
  repository in the organization with one stored token.
- **Commit messages from your own AI provider** — Anthropic, OpenAI, Gemini or
  OpenRouter — with live model lists and prices, and a Concise / Detailed /
  Thorough setting for how much the description says.
- **Self-updating** from this repository's releases, with *Check for Updates…*
  in the app menu.

The **[feature guide](docs/knwr-features.md)** covers each of these in detail,
including how to release a new version.

## Where can I get it?

Every release at <https://github.com/hendrickcastro/ghdesktop/releases> ships
a macOS (Apple silicon) disk image and zip, and Windows x64 installers.

**macOS — one command**, which installs to Applications, clears the quarantine
flag and opens the app:

```sh
curl -sL https://raw.githubusercontent.com/hendrickcastro/ghdesktop/production/install.sh | bash
```

**Windows**: run `GitHubDesktopKNWRSetup-x64.exe` (or the `.msi` for a
machine-wide install).

Builds are ad-hoc signed and not notarized — see the guide's
[installing](docs/knwr-features.md#installing) and
[keychain](docs/knwr-features.md#macos-keychain-prompts) sections for what
that means on first launch and after updates. The app installs alongside the
official GitHub Desktop without interfering with it.

<picture>
  <source
    srcset="https://user-images.githubusercontent.com/634063/202742848-63fa1488-6254-49b5-af7c-96a6b50ea8af.png"
    media="(prefers-color-scheme: dark)"
  />
  <img
    width="1072"
    src="https://user-images.githubusercontent.com/634063/202742985-bb3b3b94-8aca-404a-8d8a-fd6a6f030672.png"
    alt="A screenshot of the GitHub Desktop application showing changes being viewed and committed with two attributed co-authors"
  />
</picture>

## Is GitHub Desktop right for me? What are the primary areas of focus?

[This document](https://github.com/desktop/desktop/blob/development/docs/process/what-is-desktop.md) describes the focus of GitHub Desktop and who the product is most useful for.

## I have a problem with GitHub Desktop

Note: The [GitHub Desktop Code of Conduct](https://github.com/desktop/desktop/blob/development/CODE_OF_CONDUCT.md) applies in all interactions relating to the GitHub Desktop project.

First, please search the [open issues](https://github.com/desktop/desktop/issues?q=is%3Aopen)
and [closed issues](https://github.com/desktop/desktop/issues?q=is%3Aclosed)
to see if your issue hasn't already been reported (it may also be fixed).

There is also a list of [known issues](https://github.com/desktop/desktop/blob/development/docs/known-issues.md)
that are being tracked against Desktop, and some of these issues have workarounds.

If you can't find an issue that matches what you're seeing, open a [new issue](https://github.com/desktop/desktop/issues/new/choose),
choose the right template and provide us with enough information to investigate
further.

## The issue I reported isn't fixed yet. What can I do?

If nobody has responded to your issue in a few days, you're welcome to respond to it with a friendly ping in the issue. Please do not respond more than a second time if nobody has responded. The GitHub Desktop maintainers are constrained in time and resources, and diagnosing individual configurations can be difficult and time consuming. While we'll try to at least get you pointed in the right direction, we can't guarantee we'll be able to dig too deeply into any one person's issue.

## How can I contribute to GitHub Desktop?

The [CONTRIBUTING.md](./.github/CONTRIBUTING.md) document will help you get setup and
familiar with the source. The [documentation](docs/) folder also contains more
resources relevant to the project.

If you're looking for something to work on, check out the [help wanted](https://github.com/desktop/desktop/issues?q=is%3Aissue+is%3Aopen+label%3A%22help%20wanted%22) label.

## Building Desktop

To setup your development environment for building Desktop, check out: [`setup.md`](./docs/contributing/setup.md).

## More Resources

See [desktop.github.com](https://desktop.github.com) for more product-oriented
information about GitHub Desktop.

See our [getting started documentation](https://docs.github.com/en/desktop/overview/getting-started-with-github-desktop) for more information on how to set up, authenticate, and configure GitHub Desktop.

## License

**[MIT](LICENSE)**

The MIT license grant is not for GitHub's trademarks, which include the logo
designs. GitHub reserves all trademark and copyright rights in and to all
GitHub trademarks. GitHub's logos include, for instance, the stylized
Invertocat designs that include "logo" in the file title in the following
folder: [logos](app/static/logos).

GitHub® and its stylized versions and the Invertocat mark are GitHub's
Trademarks or registered Trademarks. When using GitHub's logos, be sure to
follow the GitHub [logo guidelines](https://github.com/logos).
