#include <iostream>

int main() {
    int n;
    std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> a[i];
    }
    // 开始观察算法
    for (int i = 0; i < n - 1; i = i + 1) {
        int changed = 0;
        for (int j = 0; j < n - 1 - i; j = j + 1) {
            if (a[j] > a[j + 1]) {
                // 交换开始
                int temp = a[j];
                a[j] = a[j + 1];
                a[j + 1] = temp;
                // 交换结束

                changed = 1;
            }
        }
        if (changed == 0) { break; }
    }
    for (int i = 0; i < n; i = i + 1) {
        std::cout << a[i] << " ";
    }
    std::cout << "\n";

    return 0;
}
