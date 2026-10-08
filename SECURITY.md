# Security policy

## Supported versions

Mediaplane is pre-1.0. Only the latest release receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability reporting.
Open the repository's **Security** tab and choose **Report a vulnerability**. Please do
not open a public issue.

## Scope

Mediaplane controls Docker on its host, which is equivalent to root access. These are in
scope:

- anything that lets someone drive Mediaplane without authorisation;
- anything that lets someone read its secrets;
- anything that makes it act outside its own Compose project.

Vulnerabilities in the upstream apps that Mediaplane deploys, such as Sonarr or Jellyfin,
should be reported to those projects.
