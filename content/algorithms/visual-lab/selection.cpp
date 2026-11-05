#include <iostream>

int main() {
    int n;
    std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> a[i];
    }
    // 开始观察算法
    for (int i = 0; i < n; i = i + 1) {
        int best = i;
        for (int j = i + 1; j < n; j = j + 1) {
            if (a[j] < a[best]) { best = j; }
        }
        // 交换开始
        int temp = a[i];
        a[i] = a[best];
        a[best] = temp;
        // 交换结束

    }
    for (int i = 0; i < n; i = i + 1) {
        std::cout << a[i] << " ";
    }
    std::cout << "\n";

    return 0;
}
