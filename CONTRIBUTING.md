# Contributing to CozanetOS

Thank you for your interest in helping build CozanetOS! We are excited to welcome you to our community.

---

## 🛠️ Code of Conduct
Please be polite, professional, and respectful. We expect all contributors to adhere to a healthy, inclusive, and collaborative atmosphere.

---

## 🏗️ Monorepo Strategy
CozanetOS utilizes a split-monorepo setup:
- This repository (**`cozanet-os`**) acts as the root monorepo, maintaining project-wide guides, bootstrapping scripts, and monorepo configurations.
- Each core system engine is developed in its own distinct repository under the `CozanetOS` GitHub organization.

---

## 🌿 Branching Policy & Git Workflow
1. Fork the specific engine repository you wish to modify.
2. Create a feature branch with a descriptive name:
   ```bash
   git checkout -b feat/add-parallel-inference
   ```
3. Commit your changes using **Conventional Commits**:
   - `feat: added key rotation mechanism to Groq engine`
   - `fix: resolved memory leak in L1 cache manager`
   - `docs: updated architecture schema`
4. Submit a Pull Request targeting the `main` branch.

---

## 🧪 Testing & Verification
All modifications must be fully covered by unit tests. To run tests across all active local packages:
```bash
npm run test
```

Ensure all continuous integration checks are green before requesting code review.
