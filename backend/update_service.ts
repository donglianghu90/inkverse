import * as fs from 'fs';

const filePath = '/Users/hudongliang/Documents/project/inkverse/backend/apps/public-api/src/modules/template/visual-style/drama-visual-style-template.service.ts';
let content = fs.readFileSync(filePath, 'utf-8');

// replace { userId: null as any } with { userId: IsNull() }
content = content.replace(/userId: null as any/g, 'userId: IsNull()');
if (!content.includes('IsNull')) {
    content = content.replace(`import { Repository } from 'typeorm';`, `import { Repository, IsNull } from 'typeorm';`);
} else if (content.includes('import { InjectRepository }') && !content.includes('IsNull')) {
    content = content.replace(`import { Repository } from 'typeorm';`, `import { Repository, IsNull } from 'typeorm';`);
}

fs.writeFileSync(filePath, content);
