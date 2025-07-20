# 🗂 Project Structure: Agile Automation Playground

This document outlines the structure, purpose, and interdependencies of the files that make up the **Agile Automation Playground**. This GitHub repository serves as a sandbox for testing workflows, validation, and agile project management using GitHub-native tools.

---

## 📁 Root Directory

### `robots.txt`

* **Purpose:** Prevents bots from crawling the contents of the public repo.
* **Relationships:** None

### `README.md`

* **Purpose:** Describes the repository’s experimental nature and states that external contributions are not accepted.
* **Relationships:** None

### `LICENSE.md`

* **Purpose:** MIT license allowing general reuse, though repo is not intended for real-world distribution.
* **Relationships:** None

### `CONTRIBUTING.md`

* **Purpose:** Explains the repo is closed to outside contributions.
* **Relationships:** None

### `CODE_OF_CONDUCT.md`

* **Purpose:** Reinforces that no community interaction or collaboration is expected.
* **Relationships:** None

---

## 📁 .github/ISSUE\_TEMPLATE

### `Feature Request.yaml`

* **Purpose:** Issue form for proposing new features or enhancements using structured markdown.
* **Relationships:**

  * Consumed by: `feature-request-validation.yaml`
  * Triggered through: `ticket-creation.yaml`, `ticket-edited.yaml`

---

## 📁 .github/workflows

### `add-labels.yaml`

* **Purpose:** Validates a list of labels and applies them to an issue or PR.
* **Relationships:**

  * Used in: `ticket-creation.yaml`
  * Designed to be reusable across future workflows

### `add-to-default-project.yaml`

* **Purpose:** Automatically adds newly created issues to a default GitHub Project board.
* **Relationships:**

  * Used in: `ticket-creation.yaml`

### `close-prs-without-write-access.yaml`

* **Purpose:** Auto-closes pull requests from users without write access.
* **Note:** Outside the scope of the prototype’s agile automation goals.
* **Relationships:** None

### `feature-request-validation.yaml`

* **Purpose:** Validates required sections of Feature Request issues. Adds/removes labels and posts user-facing comments.
* **Relationships:**

  * Used by: `ticket-creation.yaml`, `ticket-edited.yaml`
  * Paired with: `Feature Request.yaml`

### `ticket-creation.yaml`

* **Purpose:** Entry point automation for newly created issues. Adds labels, moves issues to a project, and triggers validation.
* **Relationships:**

  * Uses: `add-to-default-project.yaml`, `add-labels.yaml`, `feature-request-validation.yaml`
  * Triggers on: `issues.opened`

### `ticket-edited.yaml`

* **Purpose:** Watches for edits to invalid Feature Requests and reruns validation. Updates labels and comments accordingly.
* **Relationships:**

  * Uses: `feature-request-validation.yaml`
  * Complements: `ticket-creation.yaml`

---

## ✅ Summary

This structure supports a modular and expandable automation system to:

* Standardize feature intake
* Enforce quality via validation
* Auto-organize tickets for triage

It serves as a **foundation for agile experimentation** within GitHub and provides reusable components for broader application in future workflows.
