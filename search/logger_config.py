#!/usr/bin/env python3
# -*- coding:utf-8 -*-

import logging
import os
from datetime import datetime

# 防止重复配置的全局标志
_logger_configured = False

def setup_logger(name="composite_vis", level=logging.INFO, log_dir="logs"):
    """
    设置统一的logger
    
    Args:
        name: logger名称
        level: 日志级别
        log_dir: 日志文件目录
    
    Returns:
        logger对象
    """
    global _logger_configured
    
    # 创建logger
    logger = logging.getLogger(name)
    
    # 如果已经配置过，直接返回
    if _logger_configured:
        return logger
        
    logger.setLevel(level)
    
    # 清除已有的handlers
    logger.handlers.clear()
    
    # 防止日志传播到父logger，避免重复输出
    logger.propagate = False
    
    # 清除root logger的handlers，防止其他模块的basicConfig影响
    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    
    # 创建日志目录
    os.makedirs(log_dir, exist_ok=True)
    
    # 创建formatter
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # 创建控制台handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    
    # 判断是否禁用日志文件写入
    if os.environ.get("LOG_DISABLE") == "1":
        # 只添加控制台 handler，不写文件
        logger.addHandler(console_handler)
    else:
        # 创建文件handler
        log_filename = os.path.join(log_dir, f"{name}_{datetime.now().strftime('%Y%m%d')}.log")
        file_handler = logging.FileHandler(log_filename, encoding='utf-8')
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        # 添加handler到logger
        logger.addHandler(console_handler)
        logger.addHandler(file_handler)
    
    # 设置配置标志
    _logger_configured = True
    
    return logger

# 创建全局logger实例
logger = setup_logger()
