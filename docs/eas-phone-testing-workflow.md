# Phone Testing Workflow

Use this workflow to test changes on a phone without pushing them to the official production branch.

## Branches

- `main`: official stable app
- `testing`: phone testing and preview updates

## One-time Expo/EAS setup

Run these from the project folder:

```bash
cd "/Users/PapaBear/Desktop/Dimensions Admin/Dimensions"
git checkout testing
npx eas-cli@latest login
npx eas-cli@latest update:configure
```

`update:configure` links the app to an Expo project and adds the EAS project/update fields to `app.json`.
Commit and push those generated config changes on `testing`.

## Create the preview phone build

After the app is linked to EAS, create an internal preview build:

```bash
npx eas-cli@latest build --profile preview --platform ios
```

For Android, use:

```bash
npx eas-cli@latest build --profile preview --platform android
```

Install that preview build on the phone from the EAS build link.

## Publish testing updates

For normal JavaScript, UI, styling, and image asset changes:

```bash
git checkout testing
npm run build
npx eas-cli@latest update --channel preview --message "Describe the test change"
```

Open, close, and reopen the preview app on the phone. The app checks the `preview` channel and should download the new update.

## Promote tested work to official

Once the phone-tested version is approved:

```bash
git checkout main
git merge testing
git push origin main
```

Publish the production update only when ready:

```bash
npx eas-cli@latest update --channel production --message "Describe the production release"
```

## When a new build is required

Use `eas update` for JavaScript/UI changes.

Create a new EAS build when you add or change native dependencies, native permissions, app config that affects native code, bundle identifiers, camera/native modules, or SDK versions.
