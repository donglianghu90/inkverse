import { join } from "path";
import { read } from "properties-parser";
import { Logger } from "@nestjs/common";
import * as fs from "fs";

async function loadConfig(customConfigPath?: string) {
  const localAppConfig = async () => {
    // 使用传入的配置路径或默认路径
    const configPath = customConfigPath || join(process.cwd(), "config", "application.properties");
    
    // 检查文件是否存在
    if (!fs.existsSync(configPath)) {
      Logger.error(`配置文件不存在: ${configPath}`);
      return {};
    }
    
    try {
      const properties = read(configPath);
      
      // 检查properties是否为空
      if (!properties || Object.keys(properties).length === 0) {
        Logger.warn("配置文件为空或无有效配置");
        return {};
      }
      
      // 使用 reduce 方法更简洁地构建嵌套对象
      return Object.entries(properties).reduce((config, [key, value]) => {
        // 跳过空键
        if (!key || key.trim() === '') {
          return config;
        }
        
        const keyPath = key.trim().split('.');
        let current = config;
        
        // 遍历路径的除最后一部分外的所有部分
        for (let i = 0; i < keyPath.length - 1; i++) {
          const pathKey = keyPath[i].trim();
          if (pathKey === '') continue; // 跳过空的路径段
          current[pathKey] = current[pathKey] || {};
          current = current[pathKey];
        }
        
        // 设置最终值
        const finalKey = keyPath[keyPath.length - 1].trim();
        if (finalKey !== '') {
          current[finalKey] = value;
        }
        return config;
      }, {});
    } catch (error) {
      Logger.error(`读取配置文件失败: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
  };
  const configs = await localAppConfig();
  return configs;
}

export const configuration = async (configPath?: string) => {
  const config = await loadConfig(configPath);
  Logger.log(
    "-------------------------------------配置文件start---------------------------------------"
  );
  Logger.log(config);
  Logger.log(
    "-------------------------------------配置文件 end---------------------------------------"
  );
  return config;
};
