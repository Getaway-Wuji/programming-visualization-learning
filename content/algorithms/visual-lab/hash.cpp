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
    int head[7]; int next[12];
    for (int h = 0; h < 7; h = h + 1) { head[h] = -1; }
    for (int i = 0; i < n; i = i + 1) {
        int bucket = (a[i] % 7 + 7) % 7;
        next[i] = head[bucket]; head[bucket] = i;
    }
    int bucket = (target % 7 + 7) % 7;
    int current = head[bucket];
    while (current != -1) {
        if (a[current] == target) { found = current; break; }
        current = next[current];
    }
    std::cout << found << "\n";
    return 0;
}
