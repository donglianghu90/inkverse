import * as xml2js from 'xml2js';

/**
 * XML 解析中间件
 * 自动检测并解析 XML 请求
 */
export const xmlParser = () => {
  return (req: any, res: any, next: any) => {
    // 检查是否为 XML 请求
    const contentType = req.headers['content-type'] || '';
    const isXmlRequest = contentType.includes('application/xml') || 
                        contentType.includes('text/xml') ||
                        contentType.includes('xml');
    
    if (isXmlRequest) {
      // 如果已经有 body，说明被其他中间件处理过了
      if (req.body) {
        console.log('XML Parser Middleware - Body already exists:', typeof req.body);
        // 如果 body 是字符串，尝试解析为 XML
        if (typeof req.body === 'string') {
          const parser = new xml2js.Parser({ 
            explicitArray: false,
            ignoreAttrs: false,
            trim: true
          });
          
          parser.parseString(req.body, (err: any, result: any) => {
            if (err) {
              console.error('XML 解析失败:', err);
              // 保持原始字符串
            } else {
              console.log('XML 解析成功:', result);
              req.body = result;
            }
            next();
          });
        } else {
          next();
        }
        return;
      }
      
      // 处理原始请求体
      let data = '';
      req.setEncoding('utf8');
      
      req.on('data', (chunk: string) => {
        data += chunk;
      });
      
      req.on('end', () => {
        if (data) {
          const parser = new xml2js.Parser({ 
            explicitArray: false,
            ignoreAttrs: false,
            trim: true
          });
          
          parser.parseString(data, (err: any, result: any) => {
            if (err) {
              console.error('XML 解析失败:', err);
              req.body = data; // 保留原始数据
            } else {
              console.log('XML 解析成功:', JSON.stringify(result, null, 2));
              req.body = result;
            }
            next();
          });
        } else {
          console.log('XML Parser Middleware - No data received');
          next();
        }
      });
      
      req.on('error', (err: any) => {
        console.error('XML Parser Middleware - Request error:', err);
        next(err);
      });
    } else {
      next();
    }
  };
};
