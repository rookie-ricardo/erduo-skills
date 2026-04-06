#!/usr/bin/env python3
"""
自动修正中文译文中的英文标点为中文全角标点
"""
import re
import sys

def fix_chinese_punctuation(text):
    """自动替换英文标点为中文全角标点"""
    # 保护代码块
    code_blocks = []
    def save_code(match):
        code_blocks.append(match.group(0))
        return f"__CODE_BLOCK_{len(code_blocks)-1}__"
    
    text = re.sub(r'```.*?```', save_code, text, flags=re.DOTALL)
    text = re.sub(r'`[^`]+`', save_code, text)
    
    # 替换标点：只替换中文字符周围的英文标点
    # 中文字符范围：\u4e00-\u9fff 基本汉字，\u3000-\u303f 中文标点，\uff00-\uffef 全角字符
    CJK = r'[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2000-\u206f]'

    # 逗号：前面或后面是中文字符时替换
    text = re.sub(rf'({CJK}),|,({CJK})', lambda m: (m.group(1) or '') + '，' + (m.group(2) or ''), text)
    # 再处理两侧都是中文的情况（上面已经处理了单侧，重复一次确保全覆盖）
    text = re.sub(rf'({CJK}),({CJK})', r'\1，\2', text)

    # 句号：前面是中文字符时替换（句号后面常接空格或换行）
    text = re.sub(rf'({CJK})\.\s*(?=[^a-zA-Z0-9/]|$)', r'\1。', text)

    # 冒号：前面是中文字符时替换（保护 URL 中的 :// ）
    text = re.sub(rf'({CJK}):(?!//)', r'\1：', text)
    text = re.sub(rf':({CJK})', r'：\1', text)

    # 问号：前面是中文字符时替换
    text = re.sub(rf'({CJK})\?', r'\1？', text)

    # 感叹号：前面是中文字符时替换
    text = re.sub(rf'({CJK})!', r'\1！', text)
    
    # 恢复代码块
    for i, code in enumerate(code_blocks):
        text = text.replace(f"__CODE_BLOCK_{i}__", code)
    
    return text

def main():
    if len(sys.argv) != 3:
        print("用法: python fix_punctuation.py <输入文件> <输出文件>")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        fixed = fix_chinese_punctuation(content)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(fixed)
        
        print(f"✓ 标点修正完成: {input_file} -> {output_file}")
        
        # 统计修改数量
        import difflib
        diff = list(difflib.unified_diff(
            content.splitlines(keepends=True),
            fixed.splitlines(keepends=True),
            lineterm=''
        ))
        changes = len([line for line in diff if line.startswith('+') or line.startswith('-')])
        print(f"  修改了约 {changes // 2} 处标点")
        
    except Exception as e:
        print(f"✗ 错误: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
