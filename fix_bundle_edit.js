const fs = require('fs');
const path = 'app/dashboard/items/bundles/[id]/edit/page.tsx';
let content = fs.readFileSync(path, 'utf8');
const pattern = /<Link href=\{`\/dashboard\/items\/\$\{bundleId \? \(\(\) => \{[\s\S]*?\}\)\(\) : ''\}\`\}>[\s\S]*?<\/Link>/m;
const replacement = `<Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>`;
content = content.replace(pattern, replacement);
fs.writeFileSync(path, content, 'utf8');
console.log('fixed');
