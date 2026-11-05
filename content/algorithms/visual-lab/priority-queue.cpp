#include <iostream>

int main() {
    int count; std::cin >> count; int a[8] = {}; int size = 0;
    // 开始观察算法
    for (int step = 0; step < count; step = step + 1) {
        int command; int value; std::cin >> command >> value;
        if (command == 1) {
            if (size == 8) { std::cout << "full "; }
            else {
                int current = size; a[size] = value; size = size + 1;
                while (current > 0) {
                    int parent = (current - 1) / 2;
                    if (a[parent] >= a[current]) { break; }
                    // 交换开始
                    int temp = a[parent]; a[parent] = a[current]; a[current] = temp;
                    // 交换结束

                    current = parent;
                }
            }
        } else {
            if (size == 0) { std::cout << "empty "; }
            else {
                std::cout << a[0] << " "; size = size - 1; a[0] = a[size]; int current = 0;
                while (current * 2 + 1 < size) {
                    int child = current * 2 + 1;
                    if (child + 1 < size && a[child + 1] > a[child]) { child = child + 1; }
                    if (a[current] >= a[child]) { break; }
                    // 交换开始
                    int temp = a[current]; a[current] = a[child]; a[child] = temp;
                    // 交换结束
                     current = child;
                }
            }
        }
    }
    std::cout << "\n";
    return 0;
}
