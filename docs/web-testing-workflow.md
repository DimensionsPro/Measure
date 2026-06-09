# Web Testing Workflow

Use this workflow when you want a browser-based phone testing ground without Apple App Store or Google Play constraints.

## Branches

- `main`: official stable app
- `testing`: web preview/testing app

## Local Web Test

Use this when your Mac is nearby:

```bash
cd "/Users/PapaBear/Desktop/Dimensions Admin/Dimensions"
git checkout testing
npm run web
```

Open the local URL from the terminal on your browser. For phone testing, the phone and Mac need to be on the same network.

## Hosted Web Preview

Use this when you want to test from a phone without carrying the Mac:

```bash
cd "/Users/PapaBear/Desktop/Dimensions Admin/Dimensions"
git checkout testing
npm run build
npm run deploy:web:preview
```

Vercel returns a preview URL. Open that URL on the phone.

## Official Web Release

Only after testing is approved:

```bash
git checkout main
git merge testing
git push origin main
npm run deploy:web:production
```

## Notes

- Camera support depends on the phone browser allowing camera access.
- Web preview is the best platform-neutral testing ground.
- Native iOS/Android builds are still useful later for app-store style installs, but they require Apple/Google signing.
