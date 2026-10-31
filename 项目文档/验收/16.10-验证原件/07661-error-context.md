# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: memory-bugs.spec.ts >> eight-level catalog and real diagnostic remain usable at three widths
- Location: tests\browser\memory-bugs.spec.ts:282:1

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "跳到主要内容" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=e5]:
    - banner [ref=e6]:
      - button "展开或收起导航" [ref=e7] [cursor=pointer]
      - generic [ref=e10]: 受限 C++ · Bug 闯关
      - generic [ref=e11]:
        - generic [ref=e12]: 本地学习
        - link "本地数据" [ref=e13] [cursor=pointer]:
          - /url: "#/settings?panel=data"
        - button "切换为深色" [ref=e17] [cursor=pointer]
    - main [ref=e20]:
      - generic [ref=e21]:
        - navigation "当前位置" [ref=e22]:
          - list [ref=e23]:
            - listitem [ref=e24]:
              - link "C 语言课程" [ref=e25] [cursor=pointer]:
                - /url: "#/courses"
            - listitem [ref=e26]:
              - link "Bug 闯关" [ref=e29] [cursor=pointer]:
                - /url: "#/bugs"
            - listitem [ref=e30]:
              - generic [ref=e33]: 指针还没有目标
        - generic [ref=e34]:
          - paragraph [ref=e35]: 受限 C++ · 真实内存关卡
          - heading "指针还没有目标" [level=1] [ref=e36]
          - paragraph [ref=e37]: 让指针指向仍存活的输入变量，再实际解引用并输出输入及换行。
        - paragraph [ref=e38]: 尚未保存通过 · 4组真实测试 · 首次10分，重复0分。
        - paragraph [ref=e39]: 本关使用已支持的C++指针与循环子集，代码超出20类积木映射；运行才检查。地址是教学虚拟地址。修改源码或输入会清除旧运行。
        - status [ref=e41]:
          - generic [ref=e45]:
            - heading "本地档案已读取" [level=2] [ref=e46]
            - paragraph [ref=e47]: 正在显示当前浏览器中已保存的记录与设置。
        - region "内存关卡提示与解析" [ref=e48]:
          - button "查看第 2 层提示" [ref=e49] [cursor=pointer]
          - list [ref=e50]:
            - listitem [ref=e51]: 先运行并走到真实错误位置，观察p的值。
          - group [ref=e52]:
            - generic "查看修复解析与一种参考写法" [ref=e53] [cursor=pointer]
        - generic [ref=e54]:
          - generic [ref=e55]:
            - text: 测试输入
            - combobox "关卡测试输入" [ref=e56]:
              - option "negative · [-9]" [selected]
              - option "zero · [0]"
              - option "positive · [7]"
              - option "boundary · [999]"
          - button "运行本组" [ref=e57] [cursor=pointer]
          - button "提交全部4组" [ref=e58] [cursor=pointer]
          - button "取消提交" [disabled] [ref=e59]
        - paragraph [ref=e60]: 运行本组不保存通过或积分；提交全部测试且实际教学目标满足后才保存。整次提交共用原1000ms截止，每组保留原百万fuel及20,000步等上限。
        - group [ref=e61]:
          - generic "编辑历史 · 1条已保存" [ref=e62]
          - option "2026-10-31T07:49:20.879Z · 版本1 · initial" [selected]
        - generic [ref=e63]:
          - tablist "工作区域" [ref=e65]:
            - tab "编辑 C++" [selected] [ref=e66] [cursor=pointer]
            - tab "真实执行复盘" [ref=e67] [cursor=pointer]
          - tabpanel "编辑 C++" [ref=e69]:
            - generic [ref=e73]:
              - heading "编辑本关 C++ 代码" [level=2] [ref=e74]
              - textbox "编辑关卡 C++ 代码" [ref=e75]: "#include <iostream> int main() { int x; std::cin >> x; int *p; std::cout << *p << \"\\n\"; return 0; }"
              - paragraph [ref=e76]: 完整当前原文；保留std::cin的真实输入。尚未运行时，没有新诊断或通过判定。
        - region "本次真实测试反馈" [ref=e77]:
          - heading "本次测试反馈" [level=2] [ref=e78]
          - list [ref=e79]:
            - listitem [ref=e80]:
              - group [ref=e81]:
                - generic "negative：未满足 · E_UNINITIALIZED" [ref=e82]
        - status [ref=e83]: 本组尚未满足；可查看实际诊断，有轨迹时可复盘。
        - link "返回Bug关卡目录" [ref=e84] [cursor=pointer]:
          - /url: "#/bugs"
```