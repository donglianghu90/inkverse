import { DynamicModule, Module } from '@nestjs/common';
import { DEFAULT_LOG4JS_OPTIONS, Log4jsModule } from '@nestx-log4js/core';
import { LogService } from './log.service';

export interface LogConfig {
  appName: string;
  enableSeparateFiles?: boolean;
  enableAllFile?: boolean; // 新增：是否启用all.log文件
  logLevels?: {
    error?: boolean;
    warn?: boolean;
    info?: boolean;
    debug?: boolean;
  };
  customCategories?: string[];
}

@Module({})
export class LogModule {
  static register(config: string | LogConfig): DynamicModule {
    // 兼容旧的字符串参数
    const logConfig: LogConfig = typeof config === 'string' 
      ? { appName: config, enableSeparateFiles: false }
      : { 
          enableSeparateFiles: true, 
          enableAllFile: false, // 默认不启用all.log
          logLevels: { error: true, warn: true, info: true, debug: true }, 
          ...config 
        };

    const log4j_config = JSON.parse(JSON.stringify(DEFAULT_LOG4JS_OPTIONS));
    
    // 基础appenders
    const appenders: any = {
      console: {
        type: 'console',
        layout: {
          type: 'pattern',
          pattern: '%[%d{yyyy-MM-dd hh:mm:ss:SSS} %-5.5p --- [%15.15x{name}]%] %40.40f{3}  : %m',
          tokens: {
            name: (logEvent: any) => {
              return (logEvent.context && logEvent.context['name']) || '-';
            }
          }
        }
      }
    };

    // 基础categories
    const categories: any = {};

    if (logConfig.enableSeparateFiles) {
      // 创建不同级别的日志文件appenders
      if (logConfig.logLevels?.error) {
        appenders.errorFile = {
          type: 'dateFile',
          filename: `./logs/${logConfig.appName}-error.log`,
          pattern: 'yyyy-MM-dd',
          compress: true,
          mode: '0644',
          layout: {
            type: 'pattern',
            pattern: '%d{yyyy-MM-dd hh:mm:ss:SSS} %-5.5p --- [%15.15x{name}] %40.40f{3}  : %m',
            tokens: {
              name: (logEvent: any) => {
                return (logEvent.context && logEvent.context['name']) || '-';
              }
            }
          }
        };
        categories.error = {
          enableCallStack: true,
          appenders: ['console', 'errorFile'],
          level: 'error'
        };
      }

      if (logConfig.logLevels?.warn) {
        appenders.warnFile = {
          type: 'dateFile',
          filename: `./logs/${logConfig.appName}-warn.log`,
          pattern: 'yyyy-MM-dd',
          compress: true,
          mode: '0644',
          layout: {
            type: 'pattern',
            pattern: '%d{yyyy-MM-dd hh:mm:ss:SSS} %-5.5p --- [%15.15x{name}] %40.40f{3}  : %m',
            tokens: {
              name: (logEvent: any) => {
                return (logEvent.context && logEvent.context['name']) || '-';
              }
            }
          }
        };
        categories.warn = {
          enableCallStack: true,
          appenders: ['console', 'warnFile'],
          level: 'warn'
        };
      }

      if (logConfig.logLevels?.info) {
        appenders.infoFile = {
          type: 'dateFile',
          filename: `./logs/${logConfig.appName}-info.log`,
          pattern: 'yyyy-MM-dd',
          compress: true,
          mode: '0644',
          layout: {
            type: 'pattern',
            pattern: '%d{yyyy-MM-dd hh:mm:ss:SSS} %-5.5p --- [%15.15x{name}] %40.40f{3}  : %m',
            tokens: {
              name: (logEvent: any) => {
                return (logEvent.context && logEvent.context['name']) || '-';
              }
            }
          }
        };
        categories.info = {
          enableCallStack: true,
          appenders: ['console', 'infoFile'],
          level: 'info'
        };
      }

      if (logConfig.logLevels?.debug) {
        appenders.debugFile = {
          type: 'dateFile',
          filename: `./logs/${logConfig.appName}-debug.log`,
          pattern: 'yyyy-MM-dd',
          compress: true,
          mode: '0644',
          layout: {
            type: 'pattern',
            pattern: '%d{yyyy-MM-dd hh:mm:ss:SSS} %-5.5p --- [%15.15x{name}] %40.40f{3}  : %m',
            tokens: {
              name: (logEvent: any) => {
                return (logEvent.context && logEvent.context['name']) || '-';
              }
            }
          }
        };
        categories.debug = {
          enableCallStack: true,
          appenders: ['console', 'debugFile'],
          level: 'debug'
        };
      }

      // 添加自定义分类
      if (logConfig.customCategories) {
        logConfig.customCategories.forEach(category => {
          appenders[`${category}File`] = {
            type: 'dateFile',
            filename: `./logs/${logConfig.appName}-${category}.log`,
            pattern: 'yyyy-MM-dd',
            compress: true,
            mode: '0644',
            layout: {
              type: 'pattern',
              pattern: '%d{yyyy-MM-dd hh:mm:ss:SSS} %-5.5p --- [%15.15x{name}] %40.40f{3}  : %m',
              tokens: {
                name: (logEvent: any) => {
                  return (logEvent.context && logEvent.context['name']) || '-';
                }
              }
            }
          };
          categories[category] = {
            enableCallStack: true,
            appenders: ['console', `${category}File`],
            level: 'debug'
          };
        });
      }

      // 通用日志文件（包含所有级别）- 可选
      if (logConfig.enableAllFile) {
        appenders.allFile = {
          type: 'dateFile',
          filename: `./logs/${logConfig.appName}-all.log`,
          pattern: 'yyyy-MM-dd',
          compress: true,
          mode: '0644',
          layout: {
            type: 'pattern',
            pattern: '%d{yyyy-MM-dd hh:mm:ss:SSS} %-5.5p --- [%15.15x{name}] %40.40f{3}  : %m',
            tokens: {
              name: (logEvent: any) => {
                return (logEvent.context && logEvent.context['name']) || '-';
              }
            }
          }
        };
        
        // 默认分类（包含所有级别的日志）
        categories.default = {
          enableCallStack: true,
          appenders: ['console', 'allFile'],
          level: 'debug'
        };
      } else {
        // 不使用all.log时，默认分类只输出到控制台
        categories.default = {
          enableCallStack: true,
          appenders: ['console'],
          level: 'debug'
        };
      }
    } else {
      // 使用原来的单文件配置
      appenders.file = {
        type: 'dateFile',
        pattern: 'yyyy-MM-dd',
        compress: true,
        filename: `./logs/${logConfig.appName}.log`,
        mode: '0644',
        layout: {
          type: 'pattern',
          pattern: '%d{yyyy-MM-dd hh:mm:ss:SSS} %-5.5p --- [%15.15x{name}] %40.40f{3}  : %m',
          tokens: {
            name: (logEvent: any) => {
              return (logEvent.context && logEvent.context['name']) || '-';
            }
          }
        }
      };

      categories.default = {
        enableCallStack: true,
        appenders: ['console', 'file'],
        level: 'debug'
      };
    }

    log4j_config.config.appenders = appenders;
    log4j_config.config.categories = categories;

    const log4jsModule = Log4jsModule.forRoot(log4j_config);
    
    return {
      module: LogModule,
      global: true, // 设为全局模块
      imports: log4jsModule.imports,
      providers: [
        ...log4jsModule.providers,
        LogService
      ],
      exports: [
        ...log4jsModule.exports,
        LogService
      ]
    };
  }
}
