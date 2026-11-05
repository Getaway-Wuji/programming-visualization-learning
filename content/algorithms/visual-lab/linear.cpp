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
    for (int i = 0; i < n; i = i + 1) {
        if (a[i] == target) { found = i; break; }
    }
    std::cout << found << "\n";
    return 0;
}
