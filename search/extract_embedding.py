#!/usr/bin/env python3
# -*- coding:utf-8 -*-

import os
import sys
import hashlib
import numpy as np
from typing import List, Tuple, Union, Dict, Any
import json
import logging
import time
from search.logger_config import logger
# 添加LLMChart目录到路径
sys.path.append(os.path.join(os.path.dirname(__file__), 'LLMChart'))
from search.LLMChart.utils_llm import get_client, ask_question_without_image

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# 缓存目录
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')
# 确保缓存目录存在
os.makedirs(CACHE_DIR, exist_ok=True)

def get_embedding(text: Union[str, List[str]], model: str = "text-embedding-3-small", use_cache: bool = True, max_retries: int = 3) -> Union[List[float], List[List[float]]]:
    """
    使用LLMChart的client获取文本的嵌入向量，支持缓存
    
    Args:
        text: 要生成嵌入向量的文本，可以是单个字符串或字符串列表
        model: 使用的模型名称
        use_cache: 是否使用缓存
        max_retries: 最大重试次数
        
    Returns:
        单个嵌入向量或嵌入向量列表，根据输入类型返回
    """
    # 如果启用了缓存，先尝试从缓存加载
    if use_cache:
        cache_file = _get_cache_filename(text, model)
        cached_embedding = _load_from_cache(cache_file)
        if cached_embedding is not None:
            return cached_embedding
    
    # 缓存未命中，调用API获取嵌入向量
    client = get_client()
    retry = 0
    
    while retry < max_retries:
        try:
            # 创建embeddings请求
            response = client.embeddings.create(
                model=model,
                input=text
            )
            
            # 确定是返回单个向量还是向量列表
            if isinstance(text, str):
                # 获取单个嵌入向量
                embedding = response.data[0].embedding
                logger.info(f"Generated embedding with {len(embedding)} dimensions")
                
                # 保存到缓存
                if use_cache:
                    _save_to_cache(cache_file, embedding, text, model)
                
                return embedding
            else:
                # 获取多个嵌入向量
                embeddings = [data.embedding for data in response.data]
                logger.info(f"Generated {len(embeddings)} embeddings, each with {len(embeddings[0]) if embeddings else 0} dimensions")
                
                # 保存到缓存
                if use_cache:
                    _save_to_cache(cache_file, embeddings, text, model)
                
                return embeddings
            
        except Exception as e:
            logger.error(f"Error generating embedding (attempt {retry+1}/{max_retries}): {e}")
            retry += 1
            if retry < max_retries:
                logger.info(f"Retrying in 2 seconds...")
                time.sleep(2)  # 避免请求过于频繁
    
    # 如果所有重试都失败，引发异常
    raise Exception(f"Failed to generate embedding after {max_retries} attempts")

def _get_cache_filename(text: Union[str, List[str]], model: str) -> str:
    """
    获取缓存文件名
    
    Args:
        text: 文本内容，可以是字符串或字符串列表
        model: 使用的模型名称
        
    Returns:
        缓存文件路径
    """
    # 为列表或字符串创建一个稳定的哈希值
    if isinstance(text, list):
        # 对于列表，将所有内容连接起来并添加索引以确保顺序稳定
        combined_text = "".join([f"{i}:{t}" for i, t in enumerate(text)])
    else:
        combined_text = text
    
    # 创建哈希值
    cache_key = combined_text + model
    text_hash = hashlib.md5(cache_key.encode()).hexdigest()
    
    # 返回缓存文件路径
    return os.path.join(CACHE_DIR, f"embedding_{text_hash}.json")

def _load_from_cache(cache_file: str) -> Union[List[float], List[List[float]], None]:
    """
    从缓存文件加载嵌入向量
    
    Args:
        cache_file: 缓存文件路径
        
    Returns:
        缓存的嵌入向量或None（如果缓存未命中）
    """
    if not os.path.exists(cache_file):
        return None
    
    try:
        with open(cache_file, 'r', encoding='utf-8') as f:
            cached_data = json.load(f)
            logger.info(f"Cache hit: loaded embedding from {cache_file}")
            return cached_data["embedding"]
    except Exception as e:
        logger.warning(f"Failed to load cache file {cache_file}: {e}")
        return None

def _save_to_cache(cache_file: str, embedding: Union[List[float], List[List[float]]], text: Union[str, List[str]], model: str) -> None:
    """
    将嵌入向量保存到缓存文件
    
    Args:
        cache_file: 缓存文件路径
        embedding: 嵌入向量
        text: 原始文本
        model: 使用的模型
    """
    try:
        # 准备要缓存的数据
        cache_data = {
            "embedding": embedding,
            "model": model,
            "timestamp": time.time(),
            "text_sample": text[:100] if isinstance(text, str) else [t[:100] for t in text[:5]]
        }
        
        # 将数据写入缓存文件
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(cache_data, f, ensure_ascii=False)
            logger.info(f"Saved embedding to cache: {cache_file}")
    except Exception as e:
        logger.warning(f"Failed to save cache file {cache_file}: {e}")

def cosine_similarity_batch(v1: List[List[float]], v2: List[List[float]]):
    """
    批量计算多个向量对之间的余弦相似度
    
    Args:
        v1: 向量列表1
        v2: 向量列表2
        
    Returns:
        每对向量之间的余弦相似度列表
    """
    v1 = np.array(v1)
    v2 = np.array(v2)
    
    # 返回的应该是一个二维数组，每行是v1和v2中对应向量的余弦相似度
    dot_product = np.dot(v1, v2.T)
    return dot_product
    
    
    
