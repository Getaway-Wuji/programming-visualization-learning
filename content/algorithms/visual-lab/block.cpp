#include <iostream>

int main() {
    int n;
    std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> a[i];
    }
    int target; std::cin >> target;
    // 开始观察算法
    int found = -1;
    int index[4] = {}; int blocks = (n + 2) / 3;
    for (int b = 0; b < blocks; b = b + 1) {
        int end = b * 3 + 2; if (end >= n) { end = n - 1; }
        index[b] = a[end];
    }
    int block = 0;
    while (block < blocks && index[block] < target) { block = block + 1; }
    if (block < blocks) {
        for (int i = block * 3; i < n && i < block * 3 + 3; i = i + 1) {
            if (a[i] == target) { found = i; break; }
        }
    }
    std::cout << found << "\n";
    return 0;
}
