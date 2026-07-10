## Irish Ads — HAR drop folder

Save Facebook Ad Library HAR exports here, named per therapy:

```
extract/har-ie/hbot.har
extract/har-ie/ir.har
extract/har-ie/pemf.har
```

Multiple files per therapy are also supported (auto-merged, deduped by ad id):

```
extract/har-ie/hbot-1.har
extract/har-ie/hbot-2.har
```

### How to capture a HAR

1. Open https://www.facebook.com/ads/library/
2. Set **Country = Ireland**, **Ad category = All ads**
3. Search the therapy keyword (`HBOT`, `infrared sauna`, `PEMF`, etc.)
4. Open DevTools → Network → tick "Preserve log"
5. Scroll the page until you've loaded all ads you want
6. Right-click any request → **Save all as HAR with content**
7. Drop the file into this folder with the right name

### Pipeline

```
npm run extract:ie          # parse HARs → extract/ie-out/{therapy}.json
npm run generate:ie-scripts # call Claude → extract/ie-out/{therapy}-scripts.json
npm run extract             # merge into app/public/data/{therapy}.json
```
